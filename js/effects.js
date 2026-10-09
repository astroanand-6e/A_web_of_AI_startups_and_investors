// Transient motion-graphics effects, drawn between the links and the nodes:
// a comet carries each deal from investor to startup, a founding sends out a
// shockwave, and a ripple marks where a deal lands. Browser-only (reads window.d3).

import { DUR, easeCubicInOut } from './motion.js';

const { d3 } = window;

// Trail dots follow the comet head at these fractions of the link's length.
const TRAIL = Object.freeze([
    Object.freeze({ lag: 0.045, r: 3.4, opacity: 0.55 }),
    Object.freeze({ lag: 0.09, r: 2.6, opacity: 0.4 }),
    Object.freeze({ lag: 0.135, r: 1.8, opacity: 0.25 }),
]);

const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * @param layer    d3 selection of the <g> to draw into (world coordinates)
 * @param linkEnds (link) => {x1, y1, x2, y2}: the visible segment between two node rims
 */
export function createEffects(layer, { linkEnds }) {
    const live = new Set();

    // Every effect removes itself when its transition ends or is cut short.
    function track(item, transition) {
        live.add(item);
        transition.on('end.cleanup interrupt.cleanup cancel.cleanup', () => {
            live.delete(item);
            item.el.remove();
        });
    }

    function rings(node, delay, className, waves) {
        const el = layer.append('g').attr('class', className).attr('transform', `translate(${node.x},${node.y})`);
        const longest = waves.reduce((a, b) => (b.lag + b.duration > a.lag + a.duration ? b : a));
        waves.forEach((wave) => {
            const radius = node.r * wave.grow;
            const transition = el.append('circle')
                .attr('r', node.r)
                .attr('opacity', 0)
                .attr('stroke-width', wave.width)
                .transition()
                .delay(delay + wave.lag)
                .duration(wave.duration)
                .ease(d3.easeLinear)
                .attrTween('r', () => (t) => String(lerp(node.r, radius, easeOutCubic(t))))
                .attrTween('opacity', () => (t) => String(wave.opacity * (1 - t) ** 1.6))
                .attrTween('stroke-width', () => (t) => String(wave.width * (1 - 0.6 * t)));
            if (wave === longest) track({ kind: 'rings', el, node }, transition);
        });
    }

    function shockwave(node, delay, scale) {
        rings(node, delay, 'fx-shockwave', [
            { lag: 0, duration: DUR.shockwave * scale, grow: 3.6, opacity: 0.7, width: 3.5 },
            { lag: 160 * scale, duration: 920 * scale, grow: 2.4, opacity: 0.5, width: 2 },
        ]);
    }

    function ripple(node, delay, scale) {
        rings(node, delay, 'fx-ripple', [{ lag: 0, duration: DUR.ripple * scale, grow: 1.9, opacity: 0.55, width: 2.2 }]);
    }

    function placeComet(item) {
        const { x1, y1, x2, y2 } = linkEnds(item.link);
        const pointAt = (p) => [lerp(x1, x2, p), lerp(y1, y2, p)];
        const [hx, hy] = pointAt(item.progress);
        item.spark.setAttribute('transform', `translate(${hx},${hy})`);
        TRAIL.forEach((dot, i) => {
            const [tx, ty] = pointAt(Math.max(0, item.progress - dot.lag));
            item.trail[i].setAttribute('cx', tx);
            item.trail[i].setAttribute('cy', ty);
        });
    }

    // Uses the same easing as the link's growth, so on a new link the comet rides its tip.
    function comet(link, { delay = 0, duration }) {
        const el = layer.append('g').attr('class', 'fx-comet').attr('opacity', 0);
        const trail = TRAIL.map((dot) => el.append('circle')
            .attr('class', 'fx-comet__trail')
            .attr('r', dot.r)
            .attr('fill-opacity', dot.opacity)
            .node());
        const spark = el.append('g');
        spark.append('circle').attr('r', 12).attr('fill', 'url(#glow-comet)');
        spark.append('circle').attr('class', 'fx-comet__head').attr('r', 4);
        const item = { kind: 'comet', el, link, spark: spark.node(), trail, progress: 0 };
        const transition = el.transition()
            .delay(delay)
            .duration(duration)
            .ease(d3.easeLinear)
            .tween('travel', () => (t) => {
                item.progress = easeCubicInOut(t);
                el.attr('opacity', Math.min(1, t * 10, (1 - t) * 6 + 0.1));
            });
        track(item, transition);
        placeComet(item);
    }

    /** Called every frame: effects follow the nodes and links they belong to. */
    function render() {
        live.forEach((item) => {
            if (item.kind === 'comet') placeComet(item);
            else item.el.attr('transform', `translate(${item.node.x},${item.node.y})`);
        });
    }

    function clear() {
        layer.selectAll('*').interrupt();
        layer.selectAll('*').remove();
        live.clear();
    }

    return { shockwave, ripple, comet, render, clear, busy: () => live.size > 0 };
}
