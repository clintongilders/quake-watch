import { useEffect, useState } from 'react';
import EarthquakeMap, { type Earthquake } from './EarthquakeMap';

type Range = '24h' | '7d' | '30d' | 'custom';
interface Filters { range: Range; magnitude: string; from: string; through: string }
interface EarthquakeCollection {
  totalItems: number;
  member: Earthquake[];
  view?: { next?: string; last?: string };
}
function defaults(): Filters {
  const now = new Date();
  return { range: '24h', magnitude: '', from: new Date(now.getTime() - 86400000).toISOString().slice(0, 19), through: now.toISOString().slice(0, 19) };
}

export default function EarthquakeList() {
  const [filters, setFilters] = useState<Filters>(defaults);
  const [draft, setDraft] = useState<Filters>(filters);
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState(30);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [mobileView, setMobileView] = useState<'map' | 'table'>('map');
  const invalidDates = draft.range === 'custom' && (!draft.from || !draft.through || draft.from > draft.through);
  const pendingChanges = JSON.stringify(draft) !== JSON.stringify(filters);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => setRefresh(value => value + 1), 60000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    const controller = new AbortController();
    const url = new URL('https://127.0.0.1:8000/api/earthquakes');
    url.searchParams.set('page', String(page));
    url.searchParams.set('itemsPerPage', String(pageSize));
    if (filters.magnitude) url.searchParams.set('magnitude[gte]', filters.magnitude);
    if (filters.range === 'custom') {
      url.searchParams.set('occurredAt[after]', `${filters.from}Z`);
      url.searchParams.set('occurredAt[before]', `${filters.through}Z`);
    } else {
      const through = new Date();
      const days = filters.range === '24h' ? 1 : filters.range === '7d' ? 7 : 30;
      url.searchParams.set('occurredAt[after]', new Date(through.getTime() - days * 86400000).toISOString());
      url.searchParams.set('occurredAt[before]', through.toISOString());
    }
    fetch(url, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return response.json() as Promise<EarthquakeCollection>;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        const lastPage = data.view?.last ? Number(new URL(data.view.last, url).searchParams.get('page')) : 1;
        const pages = Number.isInteger(lastPage) && lastPage > 0 ? lastPage : 1;
        if (page > pages) { setPage(pages); return; }
        setEarthquakes(data.member);
        setTotalItems(data.totalItems);
        setTotalPages(pages);
        setHasNextPage(Boolean(data.view?.next));
        setLastUpdated(new Date());
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'An unknown error occurred');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, pageSize, refresh]);

  function apply(next: Filters) {
    setFilters({ ...next });
    setPage(1);
    setLoading(true);
    setError(null);
  }
  function changePage(nextPage: number) {
    setPage(nextPage);
    setLoading(true);
    setError(null);
  }
  const firstResult = totalItems ? (page - 1) * pageSize + 1 : 0;
  const lastResult = totalItems ? firstResult + earthquakes.length - 1 : 0;
  const pagination = <nav className="pagination" aria-label="Earthquake pagination">
    <span className="result-range">{firstResult}–{lastResult} of {totalItems.toLocaleString()} earthquakes</span>
    <div className="page-controls">
      <button type="button" disabled={loading || page === 1} onClick={() => changePage(page - 1)}>Previous</button>
      <span aria-live="polite">Page {page}{totalPages !== null ? ` of ${totalPages}` : ''}</span>
      <button type="button" disabled={loading || error !== null || !hasNextPage} onClick={() => changePage(page + 1)}>Next</button>
    </div>
  </nav>;

  return <section className="earthquake-panel" aria-labelledby="earthquake-heading">
    <div className="panel-toolbar"><div><h2 id="earthquake-heading">Recent earthquakes</h2><p className="panel-subtitle">Explore by time and magnitude</p></div></div>
    <form className="filter-form" onSubmit={event => { event.preventDefault(); if (!invalidDates) apply(draft); }}>
      <fieldset className="range-options"><legend>Time range</legend>
        {([['24h', 'Last 24 hours'], ['7d', '7 days'], ['30d', '30 days'], ['custom', 'Custom']] as const).map(([value, label]) =>
          <label key={value} className={draft.range === value ? 'selected' : ''}><input type="radio" name="range" value={value} checked={draft.range === value} onChange={() => setDraft({ ...draft, range: value })} />{label}</label>)}
      </fieldset>
      <div className="filter-bottom">
        <label className="filter-field" htmlFor="minimum-magnitude">Minimum magnitude<select id="minimum-magnitude" value={draft.magnitude} onChange={event => setDraft({ ...draft, magnitude: event.target.value })}>
          <option value="">All magnitudes</option>{['2', '3', '4', '5'].map(value => <option key={value} value={value}>{value}+</option>)}
        </select></label>
        {draft.range === 'custom' && <div className="custom-dates">
          <label className="filter-field">From<input required type="datetime-local" step="1" value={draft.from} max={draft.through || undefined} onInput={event => setDraft({ ...draft, from: event.currentTarget.value })} /></label>
          <label className="filter-field">Through<input required type="datetime-local" step="1" value={draft.through} min={draft.from || undefined} onInput={event => setDraft({ ...draft, through: event.currentTarget.value })} /></label>
          <span className="utc-note">Times in UTC</span>
        </div>}
        <div className="filter-actions"><button className="primary-button" type="submit" disabled={invalidDates}>Apply filters</button><button type="button" onClick={() => { const next = defaults(); setDraft(next); apply(next); }}>Reset</button></div>
      </div>
      {invalidDates && <p role="alert" className="filter-message">Choose both dates, with From on or before Through.</p>}
      {pendingChanges && !invalidDates && <p className="filter-message">Changes ready — apply filters to update results.</p>}
    </form>
    <div className="results-status">
      <span aria-live="polite">{loading ? 'Updating results…' : `${totalItems.toLocaleString()} matching earthquakes`}{lastUpdated && ` · Updated ${lastUpdated.toLocaleTimeString()}`}</span>
      <div className="refresh-controls"><label>Per page<select aria-label="Results per page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); changePage(1); }}>{[10, 30, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label><label><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} /> Auto-refresh</label><button type="button" disabled={loading} onClick={() => { setLoading(true); setRefresh(value => value + 1); }}>Refresh</button></div>
    </div>
    <div className="mobile-view-toggle" role="group" aria-label="Results view"><button type="button" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>Map</button><button type="button" aria-pressed={mobileView === 'table'} onClick={() => setMobileView('table')}>Table</button></div>
    {pagination}
    {loading ? <p className="status-message" role="status">Loading earthquakes…</p> : error ? <p className="status-message error-message" role="alert">Error: {error}</p> : earthquakes.length === 0 ? <p className="status-message" role="status">No earthquakes match these filters.</p> : <>
      <div className={`map-view ${mobileView !== 'map' ? 'mobile-hidden' : ''}`}><EarthquakeMap earthquakes={earthquakes} /></div>
      <div className={`table-view ${mobileView !== 'table' ? 'mobile-hidden' : ''}`}>
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
      </div>
    </>}
    {pagination}
  </section>;
}
