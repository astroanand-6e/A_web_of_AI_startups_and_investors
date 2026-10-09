# AI Startups & Investors Network Visualization
[link to the live website](https://astroanand-6e.github.io/A_web_of_AI_startups_and_investors/)

An interactive visualization that maps the connections between emerging AI startups and their financial backers, and replays how that web formed, month by month, as a motion-graphics timeline.

![Screenshot 2025-03-10 at 1 44 00 PM](https://github.com/user-attachments/assets/5110dbaf-87c9-463b-be64-7047e2847584)

## Features

- **Interactive network graph**: startups and investors as a force-directed network. Investor size reflects portfolio size, and link thickness reflects the number of funding rounds.
- **Motion-graphics timeline**: "Animate Timeline" replays the dataset as a choreographed sequence (about 50 seconds at 1×):
  - Startups pop in with a shockwave.
  - Investors spring in, their links draw toward the company, and a comet travels along each new link.
  - Each month gets its own beat. Quiet stretches of the calendar compress, so the pacing never drags.
- **A camera that follows the action**: a critically damped spring on position and zoom. It frames nodes just before they appear, keeps them clear of the caption card, and never jerks when its target changes mid-move. Wheel or drag to take over; *Fit* hands control back.
- **Broadcast-style HUD**:
  - a rolling odometer date
  - live startup, investor and deal counters
  - a lower-third caption for every month, whose deal rows animate in as each deal lands
- **Scrubber**:
  - Drag to any point in time, with a month preview while you hover.
  - Months with a founding are marked with dots.
  - Speeds of 1×, 2×, 4× and 0.5×, plus replay.
- **Filtering and details**: show or hide startups and investors. Hover a node for a tooltip, click it to pin its details in the sidebar.
- **Direct manipulation**: drag nodes, zoom, pan, and use *Reset View* to re-frame the whole network.
- **Accessible motion**: honours `prefers-reduced-motion` (fades replace movement, the layout holds still, and the camera cuts to one steady shot of the whole network instead of gliding) and supports full keyboard control of the timeline.
- **Responsive design**: works across screen sizes.

## Technologies Used

- **D3.js v7**: force simulation, zoom, transitions and timers
- **JavaScript (ES modules)**: no build step, no framework
- **HTML5/CSS3**: layout, HUD and motion styling
- **Font Awesome**: icons
- **Node.js test runner**: unit tests for the data, scheduling, camera and HUD logic

## Running Locally

1. Clone this repository:
   ```bash
   git clone https://github.com/astroanand-6e/A_web_of_AI_startups_and_investors.git
   cd A_web_of_AI_startups_and_investors
   ```

2. Serve the folder with any static web server (no build step):
   ```bash
   python3 -m http.server 8000
   # or: npm start
   ```

3. Open http://localhost:8000 in your browser.

Opening `index.html` straight from disk (`file://`) won't work: browsers block ES modules and `fetch()` there, so the page asks you to use a server instead.

## Usage

| Action | How |
|--------|-----|
| Play the timeline | **Animate Timeline** button |
| Play / pause | **Space** or the play button |
| Step to the next / previous month | **→** / **←** (or the arrow keys on the focused scrubber) |
| Jump to any point | Drag or click the scrubber |
| Change speed | Speed button (1× → 2× → 4× → 0.5×) |
| Leave the timeline | **Esc** or the ✕ button |
| Inspect a node | Hover for a tooltip, click to pin it in the sidebar; click the background to unpin |
| Rearrange | Drag nodes; when released, the layout's forces settle them again |
| Zoom | Mouse wheel / trackpad, or the + / − / fit buttons |
| Re-frame everything | **Reset View** |

## How the Animation Works

- **`js/schedule.js`** turns the dataset into a timeline of *beats*, one per month with activity. In each beat, foundings land first, then the deals (grouped by company), then the beat settles and holds. Pure functions answer "what has happened by time *t*?", so scrubbing anywhere is instant.
- **`js/main.js`** runs a single `d3.timer` frame loop that advances the playhead, syncs the graph, steps the camera and updates the HUD in lockstep. It stops whenever nothing is moving.
- **`js/graph.js`** keeps every node and link alive across updates (keyed joins). Nodes ease toward precomputed home positions instead of re-running a full layout, so the network grows in place rather than reshuffling.
- **`js/camera.js`** uses SmoothDamp (the spring behind most game cameras) on centre and log-zoom. The camera feels operated rather than tweened.

## Tests

```bash
npm test   # runs node --test (Node.js 20+)
```

The tests cover data normalization, the timeline schedule and stepping, the motion helpers, camera framing, the player, the HUD's odometer and captions, and the details panel's HTML escaping.

## Project Structure

```
├── index.html             # page markup, HUD and scrubber
├── styles.css             # layout, graph, HUD and motion styles
├── package.json           # npm start / npm test (no dependencies)
├── js/
│   ├── main.js            # entry point: wiring and the frame loop
│   ├── data.js            # validates and normalizes the JSON
│   ├── schedule.js        # timeline choreography (beats, events, stepping)
│   ├── timeline.js        # playhead: play, pause, seek, speed
│   ├── graph.js           # D3 force graph, entrances and exits
│   ├── effects.js         # shockwaves, ripples and comets
│   ├── camera.js          # spring camera and view fitting
│   ├── hud.js             # odometer date, counters, captions, scrubber
│   ├── details.js         # sidebar details and tooltip
│   └── motion.js          # easing, durations and SmoothDamp
├── tests/                 # node --test suites
├── data/
│   └── ai_startups_timeline.json
├── logos/                 # startup logos
└── list_investors.md
```

## Data Format

`data/ai_startups_timeline.json` contains two arrays. Months are `YYYY-MM`.

```json
{
  "startups": [
    { "name": "OpenAI", "founded": "2015-12", "comment": "OpenAI founded with a mission to advance AI research", "logo": "logos/OpenAI.png" }
  ],
  "investments": [
    { "investor": "Y Combinator", "startup": "OpenAI", "date": "2015-12", "comment": "Y Combinator provides early seed funding to OpenAI" }
  ]
}
```

- `logo` and `comment` are optional.
- A round dated before its startup's founding plays at the founding month.
- Investments that name an unknown startup are skipped, with a console warning.
