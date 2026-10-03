import EarthquakeMap from "./EarthquakeMap";
import {
  defaults,
  useEarthquakes,
  type Filters,
} from "../hooks/useEarthquakes";
import { depthLabel, magnitudeLabel, type Earthquake } from "../lib/api";

const EMPTY_QUAKES: Earthquake[] = [];

export default function EarthquakeList() {
  const {
    applyFilters,
    state,
    dispatch,
    autoRefresh,
    setAutoRefresh,
    table,
    map,
    totalItems,
    totalPages,
    refresh,
  } = useEarthquakes();
  const { filters, draft, page, pageSize, sort, selectedId, mobileView } =
    state;
  const earthquakes = table.data?.member ?? [];
  const loading = table.isPending;
  // Keep the previous rows on screen while a refresh or page change loads.
  const updating = table.isPlaceholderData;
  const error = table.error?.message ?? null;
  const hasNextPage = page < totalPages;
  const lastUpdated = table.dataUpdatedAt
    ? new Date(table.dataUpdatedAt)
    : null;
  const invalidDates =
    draft.range === "custom" &&
    (!draft.from || !draft.through || draft.from > draft.through);
  const pendingChanges = JSON.stringify(draft) !== JSON.stringify(filters);
  const setDraft = (value: Filters) => dispatch({ type: "draft", value });
  const apply = applyFilters;
  const changePage = (value: number) => dispatch({ type: "page", value });
  const sortColumn = (value: typeof sort.column) =>
    dispatch({ type: "sort", value });
  const setMobileView = (value: typeof mobileView) =>
    dispatch({ type: "view", value });
  function selectQuake(value: string) {
    dispatch({ type: "select", value });
    document
      .querySelector(".map-view")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function sortableHeader(column: typeof sort.column, label: string) {
    const active = sort.column === column;
    return (
      <th
        scope="col"
        aria-sort={
          active
            ? sort.direction === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
      >
        <button
          className="sort-button"
          type="button"
          onClick={() => sortColumn(column)}
        >
          <span>{label}</span>
          <span className="sort-arrow" aria-hidden="true">
            {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
      </th>
    );
  }
  const firstResult = totalItems ? (page - 1) * pageSize + 1 : 0;
  const lastResult = totalItems ? firstResult + earthquakes.length - 1 : 0;
  const pageControls = (
    <div className="page-controls">
      <button
        type="button"
        disabled={loading || updating || page === 1}
        onClick={() => changePage(page - 1)}
      >
        Previous
      </button>
      <span aria-live="polite">
        Page {page}
        {totalPages !== null ? ` of ${totalPages}` : ""}
      </span>
      <button
        type="button"
        disabled={loading || updating || error !== null || !hasNextPage}
        onClick={() => changePage(page + 1)}
      >
        Next
      </button>
    </div>
  );
  const resultRange = `${firstResult}–${lastResult} of ${totalItems.toLocaleString()} earthquakes`;
  const pagination = (
    <nav className="pagination" aria-label="Bottom earthquake pagination">
      <span className="result-range">{resultRange}</span>
      {pageControls}
    </nav>
  );

  return (
    <section className="earthquake-panel" aria-labelledby="earthquake-heading">
      <h2 id="earthquake-heading" className="sr-only">
        Recent earthquakes
      </h2>
      <form
        className={`filter-form ${draft.range === "custom" ? "has-custom-dates" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalidDates) apply(draft);
        }}
      >
        <fieldset className="range-options">
          <legend>Time range</legend>
          {(
            [
              ["24h", "Last 24 hours"],
              ["7d", "7 days"],
              ["30d", "30 days"],
              ["custom", "Custom"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={draft.range === value ? "selected" : ""}
            >
              <input
                type="radio"
                name="range"
                value={value}
                checked={draft.range === value}
                onChange={() => setDraft({ ...draft, range: value })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="filter-bottom">
          <label className="filter-field" htmlFor="minimum-magnitude">
            Magnitude
            <select
              id="minimum-magnitude"
              value={draft.magnitude}
              onChange={(event) =>
                setDraft({ ...draft, magnitude: event.target.value })
              }
            >
              <option value="">All magnitudes</option>
              {["2", "3", "4", "5"].map((value) => (
                <option key={value} value={value}>
                  {value}+
                </option>
              ))}
            </select>
          </label>
          {draft.range === "custom" && (
            <div className="custom-dates">
              <label className="filter-field">
                From
                <input
                  required
                  type="datetime-local"
                  step="1"
                  value={draft.from}
                  max={draft.through || undefined}
                  onInput={(event) =>
                    setDraft({ ...draft, from: event.currentTarget.value })
                  }
                />
              </label>
              <label className="filter-field">
                Through
                <input
                  required
                  type="datetime-local"
                  step="1"
                  value={draft.through}
                  min={draft.from || undefined}
                  onInput={(event) =>
                    setDraft({ ...draft, through: event.currentTarget.value })
                  }
                />
              </label>
              <span className="utc-note">Times in UTC</span>
            </div>
          )}
          <div className="filter-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={invalidDates}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                const next = defaults();
                setDraft(next);
                apply(next);
              }}
            >
              Reset
            </button>
          </div>
        </div>
        {invalidDates && (
          <p role="alert" className="filter-message">
            Choose both dates, with From on or before Through.
          </p>
        )}
        {pendingChanges && !invalidDates && (
          <p className="filter-message">
            Changes ready — apply filters to update results.
          </p>
        )}
      </form>
      <div className="results-status">
        <div className="result-summary" aria-live="polite">
          {lastUpdated && (
            <span>Updated {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>
        <div className="refresh-controls">
          <label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />{" "}
            Auto-refresh
          </label>
          <button
            type="button"
            disabled={table.isFetching || map.isFetching}
            onClick={refresh}
          >
            Refresh
          </button>
        </div>
      </div>
      <div
        className="mobile-view-toggle"
        role="group"
        aria-label="Results view"
      >
        <button
          type="button"
          aria-pressed={mobileView === "map"}
          onClick={() => setMobileView("map")}
        >
          Map
        </button>
        <button
          type="button"
          aria-pressed={mobileView === "table"}
          onClick={() => setMobileView("table")}
        >
          Table
        </button>
      </div>
      <div
        className={`map-view ${mobileView !== "map" ? "mobile-hidden" : ""}`}
      >
        {map.isFetching && (
          <p className="status-message" role="status">
            Updating map results…
          </p>
        )}
        {map.error && (
          <p className="status-message error-message" role="alert">
            Unable to load map results: {map.error.message}. Use Refresh to
            retry.
          </p>
        )}
        {map.data?.truncated && (
          <p role="alert">
            Showing 50,000 of {map.data.totalItems.toLocaleString()}{" "}
            earthquakes. Narrow the filters to display every result.
          </p>
        )}
        <EarthquakeMap
          earthquakes={map.data?.earthquakes ?? EMPTY_QUAKES}
          selectedId={selectedId}
          fitKey={map.data?.fitKey ?? JSON.stringify(filters)}
        />
      </div>
      {loading ? (
        <p className="status-message" role="status">
          Loading earthquakes…
        </p>
      ) : error ? (
        <p className="status-message error-message" role="alert">
          Error: {error}
        </p>
      ) : earthquakes.length === 0 ? (
        <p className="status-message" role="status">
          No earthquakes match these filters.
        </p>
      ) : (
        <>
          <div
            className={`table-view ${mobileView !== "table" ? "mobile-hidden" : ""}`}
          >
            <div className="table-toolbar">
              <span className="result-range" aria-live="polite">
                {resultRange}
              </span>
              <div className="per-page-control">
                <label>
                  Per page
                  <select
                    aria-label="Results per page"
                    value={pageSize}
                    onChange={(event) => {
                      dispatch({
                        type: "size",
                        value: Number(event.target.value),
                      });
                    }}
                  >
                    {[10, 30, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <nav
                className="top-pagination"
                aria-label="Top earthquake pagination"
              >
                {pageControls}
              </nav>
            </div>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Recent earthquake results"
              aria-busy={updating}
            >
              <table>
                <thead>
                  <tr>
                    {sortableHeader("Magnitude", "Magnitude")}
                    <th scope="col">Location</th>
                    {sortableHeader("OccurredAt", "Time")}
                    {sortableHeader("Depth", "Depth")}
                  </tr>
                </thead>

                <tbody>
                  {earthquakes.map((earthquake) => (
                    <tr
                      key={earthquake.usgsId}
                      className={
                        selectedId === earthquake.usgsId ? "selected-quake" : ""
                      }
                      onClick={() => selectQuake(earthquake.usgsId)}
                    >
                      <td>
                        <span
                          className={`magnitude-badge ${(earthquake.magnitude ?? -1) >= 5 ? "magnitude-high" : (earthquake.magnitude ?? -1) >= 3 ? "magnitude-medium" : "magnitude-low"}`}
                        >
                          {magnitudeLabel(earthquake.magnitude)}
                        </span>
                      </td>
                      <td className="location-cell">
                        <button
                          type="button"
                          className="quake-select"
                          aria-label={`Show ${earthquake.place} on map`}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectQuake(earthquake.usgsId);
                          }}
                        >
                          {earthquake.place}
                        </button>
                      </td>
                      <td className="time-cell">
                        <time dateTime={earthquake.occurredAt}>
                          {new Date(earthquake.occurredAt).toLocaleString()}
                        </time>
                      </td>
                      <td className="depth-cell">
                        {depthLabel(earthquake.depth)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {pagination}
    </section>
  );
}
