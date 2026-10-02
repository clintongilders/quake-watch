import EarthquakeList from './components/EarthquakeList';

function App() {
  return (
    <main>
      <header className="app-header">
        <p className="eyebrow">EARTHQUAKE EXPLORER</p>
        <h1>Quake Watch</h1>
        <p>Explore recent earthquakes by magnitude and location.</p>
      </header>

      <EarthquakeList />
    </main>
  );
}

export default App;