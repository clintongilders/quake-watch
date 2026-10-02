import { useEffect, useState } from 'react';

import EarthquakeMap, { type Earthquake } from './EarthquakeMap';

interface EarthquakeCollection {
  totalItems: number;
  member: Earthquake[];
  view?: {
    next?: string;
  };
}

export default function EarthquakeList() {
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minimumMagnitude, setMinimumMagnitude] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [totalItems, setTotalItems] = useState(0);
  const invalidDates = Boolean(startDate && endDate && startDate > endDate);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => setRefresh(value => value + 1), 60000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);

  useEffect(() => {
    if (invalidDates) return;
    const controller = new AbortController();
    const url = new URL('https://127.0.0.1:8000/api/earthquakes');

    url.searchParams.set('page', String(page));

    if (minimumMagnitude !== '') {
      url.searchParams.set('magnitude[gte]', minimumMagnitude);
    }

    if (startDate) url.searchParams.set('occurredAt[after]', `${startDate}T00:00:00Z`);
    if (endDate) url.searchParams.set('occurredAt[before]', `${endDate}T23:59:59Z`);

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        return response.json() as Promise<EarthquakeCollection>;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setEarthquakes(data.member);
          setTotalItems(data.totalItems);
          setLastUpdated(new Date());
          setError(null);
          setHasNextPage(Boolean(data.view?.next));
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [minimumMagnitude, page, startDate, endDate, refresh, invalidDates]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    setLoading(true);
    setError(null);
  }

  const pagination = (
    <nav aria-label="Earthquake pagination">
        <button
          type="button"
          disabled={loading || invalidDates || page === 1}
          onClick={() => changePage(page - 1)}
        >
          Previous
        </button>
        <span aria-live="polite"> Page {page} </span>
        <button
          type="button"
          disabled={loading || invalidDates || error !== null || !hasNextPage}
          onClick={() => changePage(page + 1)}
        >
          Next
        </button>
      </nav>
  );

  return (
    <section className="earthquake-panel" aria-labelledby="earthquake-heading">
      <div className="panel-toolbar">
      <h2 id="earthquake-heading">Recent earthquakes</h2>
      <div className="magnitude-filter">

      <label htmlFor="minimum-magnitude">Minimum magnitude: </label>
      <select
        id="minimum-magnitude"
        value={minimumMagnitude}
        onChange={(event) => {
          setMinimumMagnitude(event.target.value);
          setPage(1);
          setLoading(true);
          setError(null);
        }}
      >
        <option value="">All</option>
        <option value="2">2+</option>
        <option value="3">3+</option>
        <option value="4">4+</option>
        <option value="5">5+</option>
      </select>
      </div>
      </div>

      <div className="date-toolbar">
        <label>From (UTC)<input type="date" value={startDate} max={endDate || undefined} onInput={event => { setStartDate(event.currentTarget.value); changePage(1); }} /></label>
        <label>Through (UTC)<input type="date" value={endDate} min={startDate || undefined} onInput={event => { setEndDate(event.currentTarget.value); changePage(1); }} /></label>
        <button type="button" onClick={() => { setStartDate(''); setEndDate(''); changePage(1); }}>Clear dates</button>
        <label className="auto-refresh"><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} /> Refresh every minute</label>
        <button type="button" disabled={loading || invalidDates} onClick={() => { setLoading(true); setRefresh(value => value + 1); }}>Refresh now</button>
      </div>
      {invalidDates && <p role="alert" className="error-message">From must be on or before Through.</p>}
      <p className="update-status" aria-live="polite">{totalItems} matching earthquakes · {lastUpdated ? `Results fetched ${lastUpdated.toLocaleTimeString()}` : 'Waiting for data'}</p>
      {!invalidDates && !loading && !error && <EarthquakeMap earthquakes={earthquakes} />}
      {pagination}

      {invalidDates ? null : loading ? (
        <p className="status-message" role="status">Loading earthquakes...</p>
      ) : error ? (
        <p className="status-message error-message" role="alert">Error: {error}</p>
      ) : earthquakes.length === 0 ? (
        <p className="status-message" role="status">No earthquakes match this filter.</p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Recent earthquake results">
        <table>
          <thead>
            <tr>
              <th scope="col">Magnitude</th>
              <th scope="col">Location</th>
              <th scope="col">Time</th>
              <th scope="col">Depth</th>
            </tr>
          </thead>

          <tbody>
            {earthquakes.map((earthquake) => (
              <tr key={earthquake.usgsId}>
                <td><span className={`magnitude-badge ${earthquake.magnitude >= 5 ? 'magnitude-high' : earthquake.magnitude >= 3 ? 'magnitude-medium' : 'magnitude-low'}`}>{earthquake.magnitude.toFixed(2)}</span></td>
                <td className="location-cell">{earthquake.place}</td>
                <td className="time-cell"><time dateTime={earthquake.occurredAt}>{new Date(earthquake.occurredAt).toLocaleString()}</time></td>
                <td className="depth-cell">{earthquake.depth.toFixed(2)} km</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {pagination}
    </section>
  );
}
