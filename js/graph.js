// The force-directed network. Nodes and links persist across updates (keyed joins),
// every node has a precomputed "home" so the layout never re-solves from scratch,
// and each change is choreographed: pops, growing links, comets and shockwaves.
// Browser-only (reads window.d3).

import { DUR, clamp } from './motion.js';
import { createEffects } from './effects.js';

const { d3 } = window;

const STARTUP_RADIUS = 30;
const LOGO_SIZE = 48;
const LINK_DISTANCE = 112;
const HOME_TICKS = 420;
const HOME_SEED = 0.1337;
const LIVE_SEED = 0.42;
const LABEL_GAP = 4;
const LABEL_EXTENT = 24;     // room below a node for its label when framing, in world units
const FAR_ZOOM = 0.72;       // below this zoom, investor labels hide unless highlighted
const LABEL_MIN_ZOOM = 0.55; // labels counter-scale down to this zoom so they stay readable
const REHEAT = Object.freeze({ natural: 0.3, pop: 0.35, quick: 0.25, filter: 0.45, reveal: 0.08, collapse: 0.05 });

const investorRadius = (portfolioSize) => 10 + 3.5 * (portfolioSize - 1);
const linkWidth = (rounds) => Math.min(1.6 + (rounds - 1) * 1.1, 5);
// Rough label width (Poppins is about 0.6em per character); only used for camera framing.
const labelHalfWidth = (node) => node.name.length * (node.type === 'startup' ? 13 : 11) * 0.3;

function cssColor(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function configureForces(sim, anchored) {
    sim.force('link', d3.forceLink().id((d) => d.id).distance(LINK_DISTANCE))
        .force('charge', d3.forceManyBody().strength((d) => (d.type === 'startup' ? -1100 : -230)).distanceMax(720))
        .force('collide', d3.forceCollide((d) => d.r + 8).strength(0.9).iterations(2))
        .force('gravityX', d3.forceX(0).strength(0.05))
        .force('gravityY', d3.forceY(0).strength(0.05));
    if (anchored) {
        // Anchors hold any subset of the network near the full layout, so the home
        // positions stay an equilibrium and nodes appear where they will rest.
        sim.force('homeX', d3.forceX((d) => d.homeX).strength(0.1))
            .force('homeY', d3.forceY((d) => d.homeY).strength(0.1));
    }
    return sim;
}

// Solves the complete network once, off-screen and deterministically.
function computeHomes(nodes, pairs) {
    const proxies = nodes.map((node) => ({ id: node.id, type: node.type, r: node.r }));
    const sim = configureForces(d3.forceSimulation(proxies).randomSource(d3.randomLcg(HOME_SEED)), false).stop();
    sim.force('link').links(pairs.map((pair) => ({ source: pair.sourceId, target: pair.targetId })));
    for (let i = 0; i < HOME_TICKS; i += 1) sim.tick();
    return new Map(proxies.map((proxy) => [proxy.id, { x: proxy.x, y: proxy.y }]));
}

function buildModel(data) {
    const base = [
        ...data.startups.map((record, order) => ({
            id: record.id, type: 'startup', name: record.name, logo: record.logo, order, r: STARTUP_RADIUS,
        })),
        ...data.investors.map((record) => ({
            id: record.id, type: 'investor', name: record.name, r: investorRadius(record.startups.length),
        })),
    ];
    const pairs = new Map();
    data.investments.forEach((deal) => {
        if (!pairs.has(deal.key)) pairs.set(deal.key, { key: deal.key, sourceId: deal.investorId, targetId: deal.startupId });
    });
    const homes = computeHomes(base, [...pairs.values()]);
    // d3-force mutates these node objects (x, y, vx, vy); they are the simulation's working state.
    const allNodes = base.map((node) => ({ ...node, homeX: homes.get(node.id).x, homeY: homes.get(node.id).y }));
    const nodeById = new Map(allNodes.map((node) => [node.id, node]));
    const allLinks = [...pairs.values()].map((pair, i) => ({
        key: pair.key,
        source: nodeById.get(pair.sourceId),
        target: nodeById.get(pair.targetId),
        gradientId: `link-gradient-${i}`,
    }));
    return { allNodes, nodeById, allLinks, linkByKey: new Map(allLinks.map((link) => [link.key, link])) };
}

function frameOf(nodes) {
    const xs = nodes.map((node) => node.homeX);
    const ys = nodes.map((node) => node.homeY);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const radius = Math.max(1, ...nodes.map((node) => Math.hypot(node.homeX - cx, node.homeY - cy)));
    return { cx, cy, radius };
}

function radialGlow(defs, id, color, strength) {
    const gradient = defs.append('radialGradient').attr('id', id);
    [[0, strength], [55, strength / 3], [100, 0]].forEach(([offset, opacity]) => {
        gradient.append('stop').attr('offset', `${offset}%`).attr('stop-color', color).attr('stop-opacity', opacity);
    });
}

function linkGradient(defs, id, colors) {
    const gradient = defs.append('linearGradient').attr('id', id).attr('gradientUnits', 'userSpaceOnUse');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', colors.investor);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', colors.startup);
    return gradient.node();
}

// Tween state lives on the element, not the datum: an exiting element and its
// re-entering replacement share one datum but animate independently.
function scaleTo(transition, target) {
    transition.attrTween('transform', function () {
        const from = this.__scale ?? 1;
        return (t) => {
            this.__scale = from + (target - from) * t;
            return `scale(${Math.max(0, this.__scale)})`;
        };
    });
}

function progressTo(transition, target) {
    transition.tween('progress', function () {
        const from = this.__progress ?? 0;
        return (t) => {
            this.__progress = from + (target - from) * t;
        };
    });
}

function appendInitial(body, d) {
    body.append('text').attr('class', 'node__initial').text(d.name.charAt(0).toUpperCase());
}

function popDuration(d, quick) {
    if (quick) return DUR.quick;
    return d.type === 'startup' ? DUR.startupPop : DUR.investorPop;
}

export function createGraph(container, data, { isReduced, timeScale, onHover, onPointerMove, onSelect, onWake }) {
    const colors = {
        startup: cssColor('--startup-color', '#10b981'),
        investor: cssColor('--investor-color', '#6366f1'),
        comet: cssColor('--comet-color', '#f59e0b'),
    };
    const { allNodes, nodeById, allLinks, linkByKey } = buildModel(data);
    const frame = frameOf(allNodes);
    const homeDistance = (node) => Math.hypot(node.homeX - frame.cx, node.homeY - frame.cy) / frame.radius;
    // The reveal ripples from the centre outward; the collapse implodes from the rim inward.
    const revealDelay = (node) => homeDistance(node) * DUR.revealSpread;
    const collapseDelay = (node) => (1 - homeDistance(node)) * DUR.collapseSpread;

    const svg = d3.select(container).insert('svg', ':first-child')
        .attr('class', 'graph')
        .attr('role', 'img')
        .attr('aria-label', 'Network graph of AI startups and their investors');
    const defs = svg.append('defs');
    const gridPattern = defs.append('pattern')
        .attr('id', 'grid-dots')
        .attr('width', 28)
        .attr('height', 28)
        .attr('patternUnits', 'userSpaceOnUse');
    gridPattern.append('circle').attr('class', 'grid-dot').attr('cx', 14).attr('cy', 14).attr('r', 1.2);
    radialGlow(defs, 'halo-startup', colors.startup, 0.38);
    radialGlow(defs, 'halo-investor', colors.investor, 0.32);
    radialGlow(defs, 'glow-comet', colors.comet, 0.75);
    defs.append('clipPath').attr('id', 'logo-clip').append('circle').attr('r', LOGO_SIZE / 2);
    const gradients = new Map(allLinks.map((link) => [link.key, linkGradient(defs, link.gradientId, colors)]));

    svg.append('rect')
        .attr('class', 'graph__backdrop')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('fill', 'url(#grid-dots)')
        .on('click', () => setPinned(null));
    const viewport = svg.append('g').attr('class', 'graph__viewport');
    const linkLayer = viewport.append('g').attr('class', 'graph__links');
    const fxLayer = viewport.append('g').attr('class', 'graph__fx');
    const nodeLayer = viewport.append('g').attr('class', 'graph__nodes');

    const sim = configureForces(d3.forceSimulation().randomSource(d3.randomLcg(LIVE_SEED)).velocityDecay(0.42), true).stop();
    const fx = createEffects(fxLayer, { linkEnds });

    let visibleNodes = [];
    let visibleLinks = [];
    let visibleIds = new Set();
    let visibleKeys = new Set();
    let roundsByKey = new Map();
    let nodeSel = nodeLayer.selectAll('g.node');
    let linkSel = linkLayer.selectAll('line.link');
    let domDirty = false;
    let busyUntil = 0;
    let hoveredId = null;
    let pinnedId = null;
    let dragging = false;
    let leftDuringDrag = false;
    let labelScale = null;

    const widthOf = (link) => linkWidth(roundsByKey.get(link.key) || 1);
    const markBusy = (ms) => {
        busyUntil = Math.max(busyUntil, d3.now() + ms);
    };

    function refreshSelections() {
        nodeSel = nodeLayer.selectAll('g.node');
        linkSel = linkLayer.selectAll('line.link');
        domDirty = false;
    }

    function removeElement() {
        if (!this.classList.contains('is-exiting')) return; // brought back before it finished leaving
        this.remove();
        domDirty = true;
    }

    // ---- interaction ------------------------------------------------------

    const drag = d3.drag()
        .on('drag', (event, d) => {
            if (!dragging) {
                dragging = true;
                sim.alphaTarget(0.25);
                svg.classed('is-dragging', true);
            }
            d.fx = event.x;
            d.fy = event.y;
            onWake();
        })
        .on('end', (event, d) => {
            if (!dragging) return; // a plain click, not a drag
            dragging = false;
            d.fx = null;
            d.fy = null;
            sim.alphaTarget(0);
            svg.classed('is-dragging', false);
            if (leftDuringDrag) {
                leftDuringDrag = false;
                setHovered(null);
            }
        });

    // While dragging, the pointer can slip off the node for a frame; only record it.
    function handleEnter(event, d) {
        if (dragging) {
            if (d.id === hoveredId) leftDuringDrag = false;
            return;
        }
        setHovered(d.id, event);
    }

    function handleLeave(d) {
        if (dragging) {
            if (d.id === hoveredId) leftDuringDrag = true;
            return;
        }
        if (hoveredId === d.id) setHovered(null);
    }

    function setHovered(id, event) {
        if (hoveredId === id) return;
        hoveredId = id;
        applyHighlight();
        onHover(id ? nodeById.get(id) : null, event);
    }

    function setPinned(id) {
        if (pinnedId === id) return;
        pinnedId = id;
        applyHighlight();
        onSelect(id ? nodeById.get(id) : null);
    }

    function applyHighlight() {
        if (domDirty) refreshSelections();
        const focus = hoveredId ?? pinnedId;
        const related = new Set(focus ? [focus] : []);
        visibleLinks.forEach((link) => {
            if (link.source.id === focus) related.add(link.target.id);
            if (link.target.id === focus) related.add(link.source.id);
        });
        svg.classed('is-highlighting', Boolean(focus));
        nodeSel.classed('is-related', (d) => related.has(d.id)).classed('is-focus', (d) => d.id === focus);
        linkSel.classed('is-related', (link) => Boolean(focus) && (link.source.id === focus || link.target.id === focus));
    }

    // ---- nodes ------------------------------------------------------------

    function buildNode(g, d) {
        g.attr('class', `node node--${d.type}`)
            .attr('transform', `translate(${d.x},${d.y})`)
            .on('pointerenter', (event) => handleEnter(event, d))
            .on('pointerleave', () => handleLeave(d))
            .on('pointermove', (event) => onPointerMove(event))
            .on('click', (event) => {
                event.stopPropagation();
                setPinned(pinnedId === d.id ? null : d.id);
            })
            .call(drag);
        const body = g.append('g').attr('class', 'node__pulse').append('g').attr('class', 'node__body');
        body.append('circle').attr('class', 'node__halo').attr('r', d.r * 2.1).attr('fill', `url(#halo-${d.type})`);
        if (d.type === 'startup') {
            body.append('circle').attr('class', 'node__ring').attr('r', d.r).style('animation-delay', `${-d.order * 0.45}s`);
        }
        body.append('circle').attr('class', 'node__disc').attr('r', d.r);
        if (d.type === 'startup') appendMark(body, d);
        g.append('g').attr('class', 'node__tag').append('text')
            .attr('class', 'node__label')
            .attr('y', d.r + LABEL_GAP)
            .attr('dy', '0.9em')
            .text(d.name);
    }

    function appendMark(body, d) {
        if (!d.logo) {
            appendInitial(body, d);
            return;
        }
        body.append('image')
            .attr('class', 'node__logo')
            .attr('href', d.logo)
            .attr('x', -LOGO_SIZE / 2)
            .attr('y', -LOGO_SIZE / 2)
            .attr('width', LOGO_SIZE)
            .attr('height', LOGO_SIZE)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .attr('clip-path', 'url(#logo-clip)')
            .on('error', function () {
                d3.select(this).remove();
                appendInitial(body, d);
            });
    }

    function animateNodesIn(entering, style) {
        if (entering.empty()) return;
        const delayOf = (d) => (style === 'reveal' ? revealDelay(d) : 0);
        const body = entering.select('.node__body');
        const label = entering.select('.node__label');
        if (isReduced()) {
            body.attr('opacity', 0).transition('presence').delay(delayOf).duration(DUR.fade).attr('opacity', 1);
            label.attr('opacity', 0).transition('fade').delay(delayOf).duration(DUR.fade).attr('opacity', 1);
            return;
        }
        const scale = timeScale();
        const quick = style === 'quick' || style === 'filter';
        body.attr('transform', 'scale(0)')
            .property('__scale', 0)
            .transition('presence')
            .delay(delayOf)
            .duration((d) => popDuration(d, quick) * scale)
            .ease(quick ? d3.easeCubicOut : d3.easeBackOut.overshoot(1.7))
            .call(scaleTo, 1);
        label.attr('opacity', 0)
            .attr('transform', 'translate(0,6)')
            .transition('fade')
            .delay((d) => delayOf(d) + DUR.linkDelay * scale)
            .duration(380 * scale)
            .ease(d3.easeCubicOut)
            .attr('opacity', 1)
            .attr('transform', 'translate(0,0)');
    }

    function animateNodesOut(exiting, style) {
        if (exiting.empty()) return;
        const collapsing = style === 'collapse';
        const delayOf = (d) => (collapsing ? collapseDelay(d) : 0);
        const duration = isReduced() ? DUR.fade : DUR.exit * (collapsing ? 1 : timeScale());
        const body = exiting.select('.node__body').transition('presence').delay(delayOf).duration(duration);
        if (isReduced()) body.attr('opacity', 0);
        else body.ease(d3.easeBackIn.overshoot(1.6)).call(scaleTo, 0);
        exiting.select('.node__label').transition('fade').delay(delayOf).duration(duration * 0.6).attr('opacity', 0);
        exiting.transition('remove').delay(delayOf).duration(duration + 40).on('end interrupt', removeElement);
    }

    // A node that comes back while it is still leaving (a quick filter flip, a scrub back and
    // forth) turns around from wherever its exit had got to, instead of a second copy popping
    // in over the shrinking one.
    function reviveNodes(nextNodes, style) {
        const nextIds = new Set(nextNodes.map((d) => d.id));
        const returning = nodeLayer.selectAll('g.node.is-exiting').filter((d) => nextIds.has(d.id));
        if (returning.empty()) return;
        returning.classed('is-exiting', false)
            .interrupt('remove') // removeElement now finds the node back and keeps it
            .each((d) => Object.assign(d, { vx: 0, vy: 0 }));
        const body = returning.select('.node__body');
        const label = returning.select('.node__label');
        if (isReduced()) {
            body.transition('presence').duration(DUR.fade).attr('opacity', 1);
            label.transition('fade').duration(DUR.fade).attr('opacity', 1);
            return;
        }
        const scale = timeScale();
        const quick = style === 'quick' || style === 'filter';
        body.transition('presence')
            .duration((d) => popDuration(d, quick) * scale)
            .ease(quick ? d3.easeCubicOut : d3.easeBackOut.overshoot(1.7))
            .call(scaleTo, 1);
        label.transition('fade')
            .duration(380 * scale)
            .ease(d3.easeCubicOut)
            .attr('opacity', 1)
            .attr('transform', 'translate(0,0)');
    }

    function joinNodes(nextNodes, style) {
        reviveNodes(nextNodes, style);
        const join = nodeLayer.selectAll('g.node:not(.is-exiting)').data(nextNodes, (d) => d.id);
        animateNodesOut(join.exit().classed('is-exiting', true), style);
        const entering = join.enter().append('g').each(function (d) {
            // A node (re)appears at rest in its home spot instead of flying in.
            Object.assign(d, { x: d.homeX, y: d.homeY, vx: 0, vy: 0, fx: null, fy: null });
            buildNode(d3.select(this), d);
        });
        animateNodesIn(entering, style);
        refreshSelections();
    }

    // ---- links ------------------------------------------------------------

    function growSpec(link, style, plan, scale) {
        const planned = plan && plan.grow.get(link.key);
        if (planned) return { ...planned, ease: d3.easeCubicInOut };
        if (style === 'reveal') {
            const delay = Math.max(revealDelay(link.source), revealDelay(link.target)) + 180;
            return { delay, duration: 560, ease: d3.easeCubicOut };
        }
        return { delay: 0, duration: DUR.quick * scale, ease: d3.easeCubicOut };
    }

    function growLink(line, link, style, plan, scale) {
        if (isReduced()) {
            line.property('__progress', 1).attr('opacity', 0).transition('grow').duration(DUR.fade).attr('opacity', 1);
            return;
        }
        const spec = growSpec(link, style, plan, scale);
        line.transition('grow').delay(spec.delay).duration(spec.duration).ease(spec.ease).call(progressTo, 1);
        markBusy(spec.delay + spec.duration);
    }

    function exitLinks(exiting, style, scale) {
        if (exiting.empty()) return;
        const delayOf = (link) => (style === 'collapse'
            ? Math.min(collapseDelay(link.source), collapseDelay(link.target)) * 0.5
            : 0);
        const transition = exiting.classed('is-exiting', true)
            .interrupt('width')
            .transition('grow')
            .delay(delayOf)
            .on('end interrupt', removeElement);
        if (isReduced()) transition.duration(DUR.fade).attr('opacity', 0);
        else transition.duration(280 * scale).ease(d3.easeCubicIn).call(progressTo, 0);
        markBusy(DUR.collapseSpread + 280 * scale);
    }

    function joinLinks(nextLinks, style, plan) {
        const scale = timeScale();
        const join = linkLayer.selectAll('line.link:not(.is-exiting)').data(nextLinks, (link) => link.key);
        exitLinks(join.exit(), style, scale);
        join.enter().append('line')
            .attr('class', 'link')
            .attr('stroke', (link) => `url(#${link.gradientId})`)
            .attr('stroke-width', widthOf)
            .property('__width', widthOf)
            .property('__progress', 0)
            .each(function (link) {
                growLink(d3.select(this), link, style, plan, scale);
            });
        // A repeat round thickens the link once its comet is most of the way there.
        join.filter(function (link) { return this.__width !== widthOf(link); })
            .property('__width', widthOf)
            .transition('width')
            .delay(plan ? plan.widthDelay : 0)
            .duration(420 * scale)
            .ease(d3.easeCubicOut)
            .attr('stroke-width', widthOf);
        refreshSelections();
    }

    /** Segment between the two node rims (clamped when the nodes overlap). */
    function linkEnds({ source, target }) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.hypot(dx, dy) || 1;
        const r1 = Math.min(source.r, dist / 2);
        const r2 = Math.min(target.r, dist - r1);
        const ux = dx / dist;
        const uy = dy / dist;
        return { x1: source.x + ux * r1, y1: source.y + uy * r1, x2: target.x - ux * r2, y2: target.y - uy * r2 };
    }

    // ---- choreography for natural playback -----------------------------------

    function planNatural(fired, nextIds, nextLinks) {
        const scale = timeScale();
        const nextKeys = new Set(nextLinks.map((link) => link.key));
        const grow = new Map();
        const effects = [];
        let widthDelay = 0;
        fired.forEach((event) => {
            if (event.kind === 'found') {
                if (nextIds.has(event.startupId)) {
                    effects.push({ type: 'shockwave', node: nodeById.get(event.startupId), delay: 80 * scale, scale });
                }
                return;
            }
            if (!nextKeys.has(event.key)) return; // hidden by a filter
            const link = linkByKey.get(event.key);
            const isRepeat = visibleKeys.has(event.key);
            const investorExisted = visibleIds.has(event.investorId);
            const delay = investorExisted ? 0 : DUR.linkDelay * scale; // a new investor pops first
            const duration = (isRepeat ? DUR.comet : DUR.linkGrow) * scale;
            if (isRepeat) widthDelay = Math.max(widthDelay, delay + duration * 0.8);
            else grow.set(event.key, { delay, duration });
            effects.push({ type: 'comet', link, delay, duration });
            if (investorExisted) effects.push({ type: 'bump', node: link.source, delay: 0, amount: 1.22 });
            const landing = delay + duration - 50 * scale;
            effects.push({ type: 'bump', node: link.target, delay: landing, amount: 1.14 });
            effects.push({ type: 'ripple', node: link.target, delay: landing, scale });
        });
        return { grow, widthDelay, effects };
    }

    function bump(nodeId, delay, amount) {
        const scale = timeScale();
        nodeLayer.selectAll('g.node:not(.is-exiting)')
            .filter((d) => d.id === nodeId)
            .select('.node__pulse')
            .transition('bump')
            .delay(delay)
            .duration(150 * scale)
            .ease(d3.easeQuadOut)
            .attr('transform', `scale(${amount})`)
            .transition()
            .duration(336 * scale)
            .ease(d3.easeBackOut.overshoot(2.4))
            .attr('transform', 'scale(1)');
    }

    const runEffect = {
        comet: (effect) => fx.comet(effect.link, effect),
        shockwave: (effect) => fx.shockwave(effect.node, effect.delay, effect.scale),
        ripple: (effect) => fx.ripple(effect.node, effect.delay, effect.scale),
        bump: (effect) => bump(effect.node.id, effect.delay, effect.amount),
    };

    function runPlan(plan) {
        if (!plan || isReduced()) return;
        plan.effects.forEach((effect) => runEffect[effect.type](effect));
    }

    // ---- public API -------------------------------------------------------------

    /**
     * Shows exactly the nodes in `nodeIds` and the links whose rounds are > 0 and
     * whose endpoints are both shown. `style` picks the choreography; `fired` lists
     * the events behind a 'natural' (forward playback) update.
     */
    function sync({ nodeIds, rounds }, { style = 'pop', fired = [] } = {}) {
        const nextNodes = allNodes.filter((node) => nodeIds.has(node.id));
        const nextIds = new Set(nextNodes.map((node) => node.id));
        const nextLinks = allLinks.filter((link) => rounds.has(link.key)
            && nextIds.has(link.source.id) && nextIds.has(link.target.id));
        roundsByKey = rounds;
        const plan = style === 'natural' ? planNatural(fired, nextIds, nextLinks) : null;

        joinNodes(nextNodes, style);
        joinLinks(nextLinks, style, plan);
        runPlan(plan);

        visibleNodes = nextNodes;
        visibleLinks = nextLinks;
        visibleIds = nextIds;
        visibleKeys = new Set(nextLinks.map((link) => link.key));

        // Clear the links first so re-initializing never sees nodes that just left.
        sim.force('link').links([]);
        sim.nodes(nextNodes);
        sim.force('link').links(nextLinks);
        // Nodes enter at their homes; with reduced motion they stay put instead of settling
        // (the simulation also starts out hot, so it is cooled outright, not just left alone).
        if (isReduced()) sim.alpha(0);
        else sim.alpha(Math.max(sim.alpha(), REHEAT[style] ?? REHEAT.pop));

        if (hoveredId && !nextIds.has(hoveredId)) setHovered(null);
        if (pinnedId && !nextIds.has(pinnedId)) setPinned(null);
        applyHighlight();
        onWake();
    }

    /** One simulation step; returns true while anything still needs frames. */
    function tick() {
        const hot = sim.alpha() >= sim.alphaMin() || sim.alphaTarget() > 0;
        if (hot) sim.tick();
        return hot || d3.now() < busyUntil || fx.busy();
    }

    function render() {
        if (domDirty) refreshSelections();
        nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
        linkSel.each(function (link) {
            const { x1, y1, x2, y2 } = linkEnds(link);
            const progress = this.__progress ?? 1;
            this.setAttribute('x1', x1);
            this.setAttribute('y1', y1);
            this.setAttribute('x2', x1 + (x2 - x1) * progress);
            this.setAttribute('y2', y1 + (y2 - y1) * progress);
            // A zero-length line with round caps would still draw a dot.
            const hidden = progress < 0.005;
            if (hidden !== this.__hidden) {
                this.__hidden = hidden;
                this.style.visibility = hidden ? 'hidden' : '';
            }
            const gradient = gradients.get(link.key);
            gradient.setAttribute('x1', x1);
            gradient.setAttribute('y1', y1);
            gradient.setAttribute('x2', x2);
            gradient.setAttribute('y2', y2);
        });
        fx.render();
    }

    /** World bounds of the visible nodes plus the homes of `extraIds` (nodes about to appear). */
    function bounds(extraIds = []) {
        const upcoming = extraIds.map((id) => nodeById.get(id)).filter((node) => node && !visibleIds.has(node.id));
        const placed = [
            ...visibleNodes.map((node) => [node, node.x, node.y]),
            ...upcoming.map((node) => [node, node.homeX, node.homeY]),
        ];
        if (!placed.length) return null;
        return placed.reduce((box, [node, x, y]) => {
            const half = Math.max(node.r, labelHalfWidth(node));
            return {
                x0: Math.min(box.x0, x - half),
                x1: Math.max(box.x1, x + half),
                y0: Math.min(box.y0, y - node.r),
                y1: Math.max(box.y1, y + node.r + LABEL_EXTENT),
            };
        }, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    }

    function setTransform({ x, y, k }) {
        viewport.attr('transform', `translate(${x},${y}) scale(${k})`);
        svg.classed('is-far', k < FAR_ZOOM);
        // The dot grid drifts at half speed and zooms gently, a cheap depth cue; with reduced
        // motion it moves with the graph instead.
        gridPattern.attr('patternTransform', isReduced()
            ? `translate(${x},${y}) scale(${k})`
            : `translate(${x * 0.5},${y * 0.5}) scale(${Math.sqrt(k)})`);
        const nextLabelScale = (1 / clamp(k, LABEL_MIN_ZOOM, 1)).toFixed(3);
        if (nextLabelScale !== labelScale) {
            labelScale = nextLabelScale;
            nodeLayer.style('--label-scale', labelScale);
        }
    }

    return {
        svg, sync, render, tick, bounds, setTransform, setPinned, clearEffects: () => fx.clear(), isDragging: () => dragging,
    };
}
