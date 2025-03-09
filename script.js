// script.js

let data, svg, simulation, zoom;

// Load JSON data - update path to be relative
fetch('./data/ai_startups_timeline.json')
    .then(response => response.json())
    .then(jsonData => {
        data = enrichDataWithTypes(jsonData);
        initializeVisualization();
    })
    .catch(error => console.error('Error loading JSON:', error));

function enrichDataWithTypes(jsonData) {
    jsonData.startups.forEach(startup => startup.type = 'startup');
    
    // Extract unique investors from investments
    const uniqueInvestors = [...new Set(jsonData.investments.map(inv => inv.investor))];
    const investors = uniqueInvestors.map(name => ({ name, type: 'investor' }));
    
    return { startups: jsonData.startups, investors, investments: jsonData.investments };
}

function initializeVisualization() {
    svg = d3.select("#cy").append("svg")
        .attr("width", "100%")
        .attr("height", "100%");

    const container = svg.append("g").attr("class", "zoom-container");

    zoom = d3.zoom()
        .scaleExtent([0.3, 10])
        .on("zoom", (event) => container.attr("transform", event.transform));
    
    svg.call(zoom);

    simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).distance(150))
        .force("charge", d3.forceManyBody().strength(-600))
        .force("center", d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2))
        .force("collision", d3.forceCollide(40));

    document.getElementById('magic-wand').addEventListener('click', animateGraph);
    document.getElementById('reset-view').addEventListener('click', resetZoom);
    
    // Add event listeners for filters
    document.getElementById('filter-startups').addEventListener('change', () => renderGraph(data.startups, data.investors, data.investments));
    document.getElementById('filter-investors').addEventListener('change', () => renderGraph(data.startups, data.investors, data.investments));
    
    addZoomControls();
    renderGraph(data.startups, data.investors, data.investments);
    
    // Hide loading overlay
    setTimeout(() => {
        document.querySelector('.loading-overlay').style.display = 'none';
    }, 1000);
}

function renderGraph(startups, investors, investments) {
    // Apply filters if set
    const showStartups = document.getElementById('filter-startups').checked;
    const showInvestors = document.getElementById('filter-investors').checked;
    
    let filteredStartups = showStartups ? startups : [];
    let filteredInvestors = showInvestors ? investors : [];
    let filteredLinks = investments.filter(inv => 
        (showStartups && showInvestors) || 
        (showStartups && filteredInvestors.some(i => i.name === inv.investor)) ||
        (showInvestors && filteredStartups.some(s => s.name === inv.startup))
    );
    
    // Clear previous elements
    svg.select(".zoom-container").selectAll("*").remove();
    const container = svg.select(".zoom-container");

    const nodes = filteredStartups.map(d => ({ id: d.name, type: 'startup', logo: d.logo, founded: d.founded }))
        .concat(filteredInvestors.map(d => ({ id: d.name, type: 'investor' })));

    const links = filteredLinks.map(d => ({ source: d.investor, target: d.startup, date: d.date }));

    // Add links with improved styling
    const link = container.selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke", "#bdc3c7")
        .attr("stroke-width", "1.5")
        .attr("stroke-opacity", 0.6)
        .attr("stroke-linecap", "round");

    // Add nodes with enhanced interactivity
    const node = container.selectAll(".node")
        .data(nodes)
        .join(
            enter => {
                const g = enter.append("g")
                    .attr("class", d => `node node-${d.type}`)
                    .on("mouseover", (event, d) => {
                        highlightConnectedNodes(event, d);
                        tooltip.transition()
                            .duration(200)
                            .style("opacity", 0.9);
                        tooltip.html(`<strong>${d.id}</strong><br>${d.type === 'startup' ? 'Founded: ' + d.founded : 'Investor'}`)
                            .style("left", (event.pageX + 10) + "px")
                            .style("top", (event.pageY - 28) + "px");
                    })
                    .on("mouseout", () => {
                        resetHighlight();
                        tooltip.transition()
                            .duration(500)
                            .style("opacity", 0);
                    })
                    .on("click", showNodeDetails)
                    .call(d3.drag()
                        .on("start", dragStarted)
                        .on("drag", dragged)
                        .on("end", dragEnded));

                // Add pulse effect for startup nodes
                g.filter(d => d.type === 'startup')
                    .append("circle")
                    .attr("r", 38)
                    .attr("class", "pulse")
                    .attr("fill", "none")
                    .attr("stroke", "#2ecc7150")
                    .attr("stroke-width", 2);

                // Add main circle
                g.append("circle")
                    .attr("r", d => d.type === 'startup' ? 35 : 20)
                    .attr("fill", d => d.type === 'startup' ? "#2ecc71" : "#3498db")
                    .attr("stroke", "white")
                    .attr("stroke-width", 2);

                // Add logo if available
                g.filter(d => d.type === 'startup' && d.logo)
                    .append("image")
                    .attr("xlink:href", d => d.logo)
                    .attr("x", -20)
                    .attr("y", -20)
                    .attr("width", 40)
                    .attr("height", 40)
                    .attr("clip-path", "circle(20px at center)");

                // Add text label
                g.append("text")
                    .text(d => d.id)
                    .attr("dy", d => d.type === 'startup' ? 50 : 35)
                    .attr("text-anchor", "middle")
                    .attr("fill", "#444")
                    .style("font-size", "12px")
                    .style("font-weight", d => d.type === 'startup' ? "bold" : "normal");
                
                return g;
            },
            update => update,
            exit => exit.transition().duration(300).style("opacity", 0).remove()
        );

    // Update simulation
    simulation.nodes(nodes).on("tick", () => {
        link.attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node.attr("transform", d => `translate(${d.x}, ${d.y})`);
    });

    simulation.force('link').links(links);
    simulation.alpha(1).restart();
    
    // Add pulse animation for startup nodes
    container.selectAll(".pulse")
        .each(function() {
            const pulse = d3.select(this);
            (function repeat() {
                pulse.transition()
                    .duration(2000)
                    .attr("r", 45)
                    .attr("stroke-opacity", 0.1)
                    .transition()
                    .duration(2000)
                    .attr("r", 38)
                    .attr("stroke-opacity", 0.4)
                    .on("end", repeat);
            })();
        });
}

function animateGraph() {
    // Clear existing graph
    svg.select(".zoom-container").selectAll("*").remove();
    
    // Reset view
    resetZoom();
    
    // Show loading overlay with animation message
    const loadingOverlay = document.querySelector('.loading-overlay');
    loadingOverlay.style.display = 'flex';
    loadingOverlay.querySelector('p').textContent = 'Preparing animation...';
    
    setTimeout(() => {
        loadingOverlay.style.display = 'none';
        
        // Create unified timeline of events
        let timelineEvents = [];
        
        // Add startup founding events
        data.startups.forEach(startup => {
            timelineEvents.push({
                type: 'startup_founded',
                startup: startup,
                date: startup.founded
            });
        });
        
        // Add investment events
        data.investments.forEach(investment => {
            timelineEvents.push({
                type: 'investment',
                investment: investment,
                date: investment.date
            });
        });
        
        // Sort all events chronologically
        timelineEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        let currentStartups = [];
        let currentInvestors = [];
        let currentInvestments = [];
        
        const nodeDelay = 1500; // Faster animation
        
        // Show animation progress
        const progressBar = d3.select("#cy").append("div")
            .attr("class", "animation-progress")
            .style("position", "absolute")
            .style("bottom", "10px")
            .style("left", "10px")
            .style("right", "10px")
            .style("height", "4px")
            .style("background", "#eee")
            .style("border-radius", "2px")
            .style("overflow", "hidden");
        
        const progress = progressBar.append("div")
            .style("height", "100%")
            .style("width", "0%")
            .style("background", "#3498db")
            .style("transition", "width 0.5s ease");
        
        // Current event display
        const eventDisplay = d3.select("#cy").append("div")
            .attr("class", "event-display")
            .style("position", "absolute")
            .style("top", "10px")
            .style("left", "10px")
            .style("background", "rgba(255,255,255,0.9)")
            .style("padding", "10px")
            .style("border-radius", "4px")
            .style("box-shadow", "0 2px 5px rgba(0,0,0,0.1)")
            .style("font-size", "14px");
        
        // Execute each timeline event with delay
        timelineEvents.forEach((event, index) => {
            setTimeout(() => {
                // Update progress
                progress.style("width", `${(index / timelineEvents.length) * 100}%`);
                
                if (event.type === 'startup_founded') {
                    // Add the startup
                    currentStartups.push(event.startup);
                    
                    // Show event info
                    eventDisplay.html(`
                        <strong>${event.startup.name}</strong> founded in ${event.startup.founded}
                        <br><span style="color: #666; font-size: 12px;">Event ${index + 1} of ${timelineEvents.length}</span>
                    `);
                } else { // investment event
                    // Only process investment if the startup exists
                    const startupExists = currentStartups.some(startup => 
                        startup.name === event.investment.startup);
                    
                    if (startupExists) {
                        // Add the investor if not already added
                        const investorName = event.investment.investor;
                        if (!currentInvestors.some(investor => investor.name === investorName)) {
                            currentInvestors.push({ name: investorName, type: 'investor' });
                        }
                        
                        // Add the investment
                        currentInvestments.push(event.investment);
                        
                        // Show event info
                        eventDisplay.html(`
                            <strong>${event.investment.investor}</strong> invested in <strong>${event.investment.startup}</strong> (${event.investment.date})
                            <br><span style="color: #666; font-size: 12px;">Event ${index + 1} of ${timelineEvents.length}</span>
                        `);
                    }
                }
                
                // Render the updated graph with animation
                renderGraph(currentStartups, currentInvestors, currentInvestments);
                
                // Clean up at the end
                if (index === timelineEvents.length - 1) {
                    setTimeout(() => {
                        progressBar.remove();
                        eventDisplay.remove();
                    }, nodeDelay);
                }
            }, index * nodeDelay);
        });
    }, 500);
}

function highlightConnectedNodes(event, node) {
    // Find all connected nodes
    const links = simulation.force('link').links();
    const connectedLinks = links.filter(link => 
        link.source.id === node.id || link.target.id === node.id);
    
    const connectedNodeIds = new Set();
    connectedLinks.forEach(link => {
        connectedNodeIds.add(link.source.id);
        connectedNodeIds.add(link.target.id);
    });
    
    // Highlight connected nodes with smooth transition
    svg.selectAll(".node")
        .transition()
        .duration(300)
        .style("opacity", d => connectedNodeIds.has(d.id) ? 1 : 0.2);
    
    // Highlight connected links with smooth transition
    svg.selectAll("line")
        .transition()
        .duration(300)
        .style("stroke", d => 
            (d.source.id === node.id || d.target.id === node.id) ? "#f39c12" : "#bdc3c7")
        .style("stroke-width", d => 
            (d.source.id === node.id || d.target.id === node.id) ? 3 : 1.5)
        .style("opacity", d => 
            (d.source.id === node.id || d.target.id === node.id) ? 1 : 0.2);
            
    // Display node details
    showNodeDetails(event, node);
}

function resetHighlight() {
    svg.selectAll(".node")
        .transition()
        .duration(300)
        .style("opacity", 1);
    
    svg.selectAll("line")
        .transition()
        .duration(300)
        .style("stroke", "#bdc3c7")
        .style("stroke-width", 1.5)
        .style("opacity", 1);
}

function showNodeDetails(event, node) {
    const nodeInfo = document.getElementById('node-details');
    
    if (node.type === 'startup') {
        const investments = data.investments.filter(inv => inv.startup === node.id);
        const investors = [...new Set(investments.map(inv => inv.investor))];
        const latestInvestment = investments.length > 0 ? 
            investments.sort((a, b) => new Date(b.date) - new Date(a.date))[0] : null;
        
        let content = `
            <div class="node-detail-header">
                <strong>${node.id}</strong> <span class="node-type startup">Startup</span>
            </div>
            <div class="node-detail-content">
                <p><i class="fas fa-calendar"></i> Founded: ${node.founded}</p>
                <p><i class="fas fa-users"></i> Investors: ${investors.length}</p>
        `;
        
        if (latestInvestment) {
            content += `<p><i class="fas fa-clock"></i> Latest Investment: ${latestInvestment.date}</p>`;
        }
        
        if (investors.length > 0) {
            content += `<div class="investors-list">
                <p><strong>Key Investors:</strong></p>
                <ul>
                    ${investors.slice(0, 5).map(inv => `<li>${inv}</li>`).join('')}
                    ${investors.length > 5 ? `<li>+ ${investors.length - 5} more...</li>` : ''}
                </ul>
            </div>`;
        }
        
        content += `</div>`;
        nodeInfo.innerHTML = content;
        
    } else {
        const investments = data.investments.filter(inv => inv.investor === node.id);
        const startups = [...new Set(investments.map(inv => inv.startup))];
        const groupedByYear = {};
        
        investments.forEach(inv => {
            const year = new Date(inv.date).getFullYear();
            if (!groupedByYear[year]) groupedByYear[year] = [];
            groupedByYear[year].push(inv);
        });
        
        let content = `
            <div class="node-detail-header">
                <strong>${node.id}</strong> <span class="node-type investor">Investor</span>
            </div>
            <div class="node-detail-content">
                <p><i class="fas fa-chart-line"></i> Investments: ${startups.length} startups</p>
                <p><i class="fas fa-file-invoice-dollar"></i> Total Rounds: ${investments.length}</p>
        `;
        
        if (Object.keys(groupedByYear).length > 0) {
            content += `<div class="investment-activity">
                <p><strong>Investment Activity:</strong></p>
                <ul class="year-list">
                    ${Object.keys(groupedByYear)
                        .sort((a, b) => b - a)
                        .slice(0, 3)
                        .map(year => `<li>${year}: ${groupedByYear[year].length} investments</li>`)
                        .join('')}
                </ul>
            </div>`;
        }
        
        if (startups.length > 0) {
            content += `<div class="startups-list">
                <p><strong>Portfolio Companies:</strong></p>
                <ul>
                    ${startups.slice(0, 5).map(startup => `<li>${startup}</li>`).join('')}
                    ${startups.length > 5 ? `<li>+ ${startups.length - 5} more...</li>` : ''}
                </ul>
            </div>`;
        }
        
        content += `</div>`;
        nodeInfo.innerHTML = content;
    }
}

// Add tooltip functionality
function createTooltip() {
    const tooltip = d3.select("body").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0)
        .style("position", "absolute")
        .style("background-color", "white")
        .style("border", "1px solid #ddd")
        .style("border-radius", "4px")
        .style("padding", "8px")
        .style("pointer-events", "none")
        .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)")
        .style("font-size", "12px")
        .style("z-index", "100");
    
    return tooltip;
}

const tooltip = createTooltip();

function addZoomControls() {
    const zoomContainer = d3.select("#cy").append("div")
        .attr("class", "zoom-controls")
        .style("position", "absolute")
        .style("bottom", "20px")
        .style("right", "20px")
        .style("background", "white")
        .style("border-radius", "4px")
        .style("box-shadow", "0 2px 5px rgba(0,0,0,0.1)")
        .style("padding", "5px");
    
    zoomContainer.append("button")
        .attr("class", "zoom-button")
        .style("width", "30px")
        .style("height", "30px")
        .style("background", "#fff")
        .style("border", "1px solid #ddd")
        .style("border-radius", "4px")
        .style("margin", "2px")
        .style("cursor", "pointer")
        .html('<i class="fas fa-plus"></i>')
        .on("click", () => {
            svg.transition().duration(300).call(zoom.scaleBy, 1.3);
        });
    
    zoomContainer.append("button")
        .attr("class", "zoom-button")
        .style("width", "30px")
        .style("height", "30px")
        .style("background", "#fff")
        .style("border", "1px solid #ddd")
        .style("border-radius", "4px")
        .style("margin", "2px")
        .style("cursor", "pointer")
        .html('<i class="fas fa-minus"></i>')
        .on("click", () => {
            svg.transition().duration(300).call(zoom.scaleBy, 0.7);
        });
    
    zoomContainer.append("button")
        .attr("class", "zoom-button")
        .style("width", "30px")
        .style("height", "30px")
        .style("background", "#fff")
        .style("border", "1px solid #ddd")
        .style("border-radius", "4px")
        .style("margin", "2px")
        .style("cursor", "pointer")
        .html('<i class="fas fa-compress-arrows-alt"></i>')
        .on("click", resetZoom);
}

function resetZoom() {
    svg.transition().duration(750).call(
        zoom.transform,
        d3.zoomIdentity.translate(window.innerWidth/2, window.innerHeight/2).scale(1)
    );
}

function dragStarted(event, node) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    node.fx = node.x;
    node.fy = node.y;
}

function dragged(event, node) {
    node.fx = event.x;
    node.fy = event.y;
}

function dragEnded(event, node) {
    if (!event.active) simulation.alphaTarget(0);
    node.fx = null;
    node.fy = null;
}
