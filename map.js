// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoidG9uMDEwIiwiYSI6ImNtaHkxbnRvdzA3aTAyaXB4bGV0amllc24ifQ.S1FLzw7baCCZDK8f3zBTxg';

const svg = d3.select('#map').select('svg');

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

/* everything that depends on the map being loaded goes inside the load event 
    everything inside will only run after the map is ready */
map.on('load', async () => {

    map.addSource('boston_route', {                         // boston_route is a unique ID for the data source
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });

    map.addLayer({
        id: 'bike-lanes',                                   // unique identifier for the layer
        type: 'line',                                       // tells Mapbox we’re drawing lines, good for bike paths 
        source: 'boston_route',
        paint: {                                            // controls the visual styling
            'line-color': 'green',
            'line-width': 3,
            'line-opacity': 0.4,
        },
    });

    /*
        instead of using Mapbox.add_layer() again we combine Mapbox and d3
        adding an SVG layer on top of our map to hold the station markers, and use D3 
        to fetch and parse the data, and to draw the markers.
    */
    let jsonData;                                           // holds the successfully loaded data
    let trips;
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
        const tripsurl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

        // Await JSON fetch
        const jsonData = await d3.json(jsonurl);
        console.log('Loaded JSON Data:', jsonData);         // Log to verify structure

        const trips = await d3.csv(tripsurl);
        console.log('Loaded JSON Trips:', trips);

        const departures = d3.rollup(
            trips,
            (v) => v.length,
            (d) => d.start_station_id,
        );

        const arrivals = d3.rollup(                         // groupby + agg
            trips,
            (v) => v.length,                                // count how many trips are in the group
            (d) => d.end_station_id,                        // groupby end_station_id 
        );

        let stations = jsonData.data.stations;              // navigates through the JSON object to retrieve the stations array

        /*
        iterates over every station; produces a new array of enriched station objects
        */
        stations = stations.map((station) => {
            let id = station.short_name;                    // get id of current station
            station.arrivals = arrivals.get(id) ?? 0;       // find station id in arrivals and return size
            station.departures = departures.get(id) ?? 0;
            station.totalTraffic = station.arrivals + station.departures;
            return station;
        });

        console.log('Stations Array:', stations);

        // square scale rather than linear because want area over radius 
        const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, (d) => d.totalTraffic)])
            .range([0, 25]);

        const circles = svg
            .selectAll('circle')
            .data(stations)
            .enter() // binds the data and appends a <circle> for each station
            .append('circle')
            .attr('r', d => radiusScale(d.totalTraffic)) // Radius of the circle
            .attr('fill', 'steelblue') // Circle fill color
            .attr('stroke', 'white') // Circle border color
            .attr('stroke-width', 1) // Circle border thickness
            .attr('opacity', 0.6)   // Circle opacity // Note: won’t see any circles yet! Must set x (cx) and y (cy) positions
            .each(function (d) {
                // Add <title> for browser tooltips
                d3.select(this)
                    .append('title')
                    .text(
                        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
                    );
            });
    
        // Function to update circle positions when the map moves/zooms
        function updatePositions() {
            circles
                .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
                .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
        }

        // Initial position update when map loads
        updatePositions();

        // Reposition markers on map interactions
        map.on('move', updatePositions); // Update during map movement
        map.on('zoom', updatePositions); // Update during zooming
        map.on('resize', updatePositions); // Update on window resize
        map.on('moveend', updatePositions); // Final adjustment after movement ends

    } catch (error) {
        console.error('Error loading JSON:', error); // Handle errors
    }   
    
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates; handles all complexities like panning, zooming, and rotating
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}
