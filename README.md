# AI Startups & Investors Network Visualization

An interactive visualization tool that maps the connections between emerging AI startups and their financial backers, offering insights into investment patterns in the artificial intelligence ecosystem.

<img width="1641" alt="AI Startup Investment Visualization" src="https://github.com/user-attachments/assets/59780332-b403-4eae-a70a-7bc5997cb817" />


## Features

- **Interactive Network Graph**: Visualize the complex relationships between AI startups and their investors
- **Timeline Animation**: Watch how the AI investment landscape has evolved over time
- **Node Filtering**: Filter the graph to show only startups or investors
- **Detailed Information**: Click on any node to view detailed information about startups or investors
- **Interactive Controls**: Zoom, pan, and reset the visualization
- **Responsive Design**: Works across different screen sizes

## Technologies Used

- **D3.js v7**: For creating the interactive network visualization
- **HTML5/CSS3**: For structure and styling
- **JavaScript**: For interactive features and data manipulation
- **Font Awesome**: For icons and visual elements

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/astroanand-6e/A_web_of_AI_startups_and_investors.git
   cd A_web_of_AI_startups_and_investors
   ```

2. No build process is required. You can serve the files using any web server:
   ```bash
   # Using Python's built-in server
   python -m http.server
   
   # Or using any other web server of your choice
   ```

3. Open http://localhost:8000 in your browser

## Usage

- **View Connections**: See how different investors are connected to AI startups
- **Animation**: Click the "Animate Timeline" button to see how investments evolved over time
- **Filter Nodes**: Use the checkbox controls to filter by node type
- **Node Details**: Click on any startup or investor to view detailed information
- **Interaction**: Drag nodes to reposition them for better visualization
- **Zoom**: Use the zoom controls or mouse wheel to zoom in/out

## Project Structure

Directory structure:
```
└── astroanand-6e-a_web_of_ai_startups_and_investors/
    ├── index.html
    ├── list_investors.md
    ├── script.js
    ├── styles.css
    ├── data/
    │   └── ai_startups_timeline.json
    └── logos/
        └── .DS_Store
    └── README.md    
```
