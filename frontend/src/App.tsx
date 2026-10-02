import EarthquakeList from "./components/EarthquakeList";

function App() {
  return (
    <main>
      <header className="app-header">
        <h1>Quake Watch</h1>
        <p>Explore recent earthquakes by magnitude and location.</p>
      </header>

      <EarthquakeList />
    </main>
  );
}

export default App;
