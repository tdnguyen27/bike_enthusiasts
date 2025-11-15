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
        inside map load event ensures that the JSON data is only fetched after the map is fully loaded and ready
        instead of using Mapbox.add_layer() again we combine Mapbox and d3
        adding an SVG layer on top of our map to hold the station markers, and use D3 
        to fetch and parse the data, and to draw the markers.
    */
    let jsonData;                                           // holds the successfully loaded data
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
        const tripsurl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

        // Await JSON fetch
        const jsonData = await d3.json(jsonurl); // console.log('Loaded JSON Data:', jsonData); 

        let trips = await d3.csv(
            tripsurl,
            (trip) => {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);
                return trip;
            },
        ); // console.log('Loaded JSON Trips:', trips);

        const stations = computeStationTraffic(jsonData.data.stations, trips); // pass Json data file (specifically stations) & trips csv file
        // console.log('Stations Array:', stations);

        // create quantize color scale for circles depending on traffic flow 
        let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

        // square scale rather than linear because want area over radius 
        const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, (d) => d.totalTraffic)])
            .range([0, 25]);

        const circles = svg
            .selectAll('circle')
            .data(stations, (d) => d.short_name) // // Use station short_name as the key
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
            })
            .style('--departure-ratio', (d) => // color scale 
                stationFlow(d.departures / d.totalTraffic),
            );
    
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

        
        /***************************** Slider Interaction ****************************/
        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');
        console.log('slider',timeSlider)
        console.log('selected time',selectedTime)
        console.log('any time label', anyTimeLabel)
        
        // update the UI when the slider moves
        function updateTimeDisplay() {
            let timeFilter = Number(timeSlider.value); // Get slider value

            if (timeFilter === -1) {
                selectedTime.textContent = ''; // Clear time display
                anyTimeLabel.style.display = 'block'; // Show "(any time)"
            } else {
                selectedTime.textContent = formatTime(timeFilter); // Display formatted time
                anyTimeLabel.style.display = 'none'; // Hide "(any time)"
            }

            // Call updateScatterPlot to reflect the changes on the map
            updateScatterPlot(timeFilter);
        }

        // bind slider’s input event to above function so that it updates the time in real-time
        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();

        // takes a Date object and returns the number of minutes since midnight
        function minutesSinceMidnight(date) {
            return date.getHours() * 60 + date.getMinutes();
        }

        // use above function to filter the data to trips that started or ended within 1 hour before or after the selected time
        function filterTripsbyTime(trips, timeFilter) {
            return timeFilter === -1
                ? trips // If no filter is applied (-1), return all trips
                : trips.filter((trip) => {
                    // Convert trip start and end times to minutes since midnight
                    const startedMinutes = minutesSinceMidnight(trip.started_at);
                    const endedMinutes = minutesSinceMidnight(trip.ended_at);

                    // Include trips that started or ended within 60 minutes of the selected time
                    return (
                        Math.abs(startedMinutes - timeFilter) <= 60 ||
                        Math.abs(endedMinutes - timeFilter) <= 60
                    );
                });
        }

        function updateScatterPlot(timeFilter) {
            // Get only the trips that match the selected time filter
            const filteredTrips = filterTripsbyTime(trips, timeFilter);

            // Recompute station traffic based on the filtered trips
            const filteredStations = computeStationTraffic(stations, filteredTrips);

            // modify the radiusScale.range() dynamically
            // If no filtering is applied (timeFilter === -1); circle sizes use the default range [0, 25]
            // If filtering is applied, range inc [3, 50], making circles more prominent
            timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

            // Update the scatterplot by adjusting the radius of circles
            circles
                .data(filteredStations, (d) => d.short_name) // Ensure D3 tracks elements correctly
                .join('circle') // Ensure the data is bound correctly
                .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
                .style('--departure-ratio', (d) => // color scale 
                    stationFlow(d.departures / d.totalTraffic),
                );
        }

    } catch (error) {
        console.error('Error loading JSON:', error); // Handle errors
    }   
    
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates; handles all complexities like panning, zooming, and rotating
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

// global function to convert slider value of minutes since midnight to formatted time (HH:MM AM/PM)
function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// compute station traffic
function computeStationTraffic(stations, trips) {
    // Compute departures
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

    /*
        iterates over every station; produces a new array of enriched station objects
    */
    return stations.map((station) => {
        let id = station.short_name;                        // get id of current station
        station.arrivals = arrivals.get(id) ?? 0;           // find station id in arrivals and return size
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}