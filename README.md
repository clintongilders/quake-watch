# Quake Watch

Quake Watch is an earthquake explorer built with React, TypeScript, and a Symfony API. It imports recent and historical USGS earthquake records into PostgreSQL and displays them on an interactive map and in a paginated table.

## Features

- View earthquake magnitude, location, occurrence time, and depth in kilometres.
- Filter by minimum magnitude: All, 2+, 3+, 4+, or 5+.
- Navigate results with Previous and Next controls.
- Sort all filtered results by magnitude, time, or depth using the table headers.
- Select a table row to highlight its earthquake on the map and open its details.
- Explore all filtered results on an interactive map, with magnitude-sized markers, depth colours, and USGS detail links.
- Choose the last 24 hours, 7 days, 30 days, or a custom UTC date/time range.
- Apply or reset filters and enable automatic refresh.
- Browse records newest first, with times displayed in the browser's local timezone.
- See loading, error, and empty-result states.

The API also exposes coordinates and supports magnitude, depth, date, and sorting filters. Run the import watcher for automatic USGS updates every five minutes. Browser auto-refresh runs one minute after map loading finishes; you can turn it off or refresh manually.

## Project structure

```text
backend/
  src/Command/ImportEarthquakesCommand.php  USGS importer
  src/Entity/Earthquake.php                Database model and API resource
  src/Repository/EarthquakeRepository.php  Doctrine repository
  migrations/                             PostgreSQL schema migrations
  config/packages/                        Database, API, and CORS configuration
  compose.yaml                            PostgreSQL container
frontend/
  src/App.tsx                             Application shell
  src/components/EarthquakeList.tsx        Filters, sorting, selection, and pagination
  src/components/EarthquakeMap.tsx         Leaflet map, markers, and selected-quake popup
  vite.config.ts                          Vite development configuration
```

The backend uses Symfony 8.1, API Platform 5, and Doctrine ORM. The frontend uses React 19, TypeScript 6, Vite 8, Leaflet 1.9, and Oxlint.

## Requirements

- PHP compatible with the locked dependencies, including PDO PostgreSQL support. `composer.json` requires PHP 8.4 or newer; some locked packages require at least 8.4.1.
- Composer.
- Node.js 22.12 or newer and npm. Vite also supports Node 20.19 or newer in the Node 20 release line.
- PostgreSQL 16, either installed locally or started with Docker Compose.
- Symfony CLI for the local HTTPS API server.
- Internet access when importing USGS records.

## Setup

Clone the repository and install dependencies:

```sh
git clone git@github.com:clintongilders/quake-watch.git
cd quake-watch
cd backend
composer install
composer check-platform-reqs
```

The following backend commands run from `backend/`.

### Configure the database

Create `backend/.env.local` with your local settings. Keep secrets out of the committed `.env` file.

```dotenv
APP_ENV=dev
APP_SECRET=replace_with_a_random_secret
DATABASE_URL="postgresql://app:your_password@127.0.0.1:5432/app?serverVersion=16&charset=utf8"
```

Generate a secret with:

```sh
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

Use the actual database username, password, port, and PostgreSQL version in `DATABASE_URL`. URL-encode special characters in database credentials.

For an existing local PostgreSQL server, create the database if needed:

```sh
php bin/console doctrine:database:create --if-not-exists
```

Alternatively, start the included PostgreSQL container:

```sh
docker compose up -d database
docker compose port database 5432
```

The Compose defaults are database `app`, user `app`, and password `!ChangeMe!`. The override file publishes PostgreSQL on a dynamically assigned host port. Use the port reported by `docker compose port` in `DATABASE_URL`. The container creates its database automatically. These credentials are local development defaults.

Apply the migrations and import initial data:

```sh
php bin/console doctrine:migrations:migrate --no-interaction
php bin/console app:import-earthquakes
```

### Start the backend

Install and trust Symfony's local certificate authority once:

```sh
symfony server:ca:install
```

Start the API:

```sh
symfony serve -d --port=8000
```

Check [https://127.0.0.1:8000/api/earthquakes](https://127.0.0.1:8000/api/earthquakes) in your browser. The frontend currently uses this exact HTTPS endpoint. Resolve any certificate trust errors before starting the frontend.

Stop the backend with:

```sh
symfony server:stop
```

### Start the frontend

In a separate terminal, from the repository root:

```sh
cd frontend
npm ci
npm run dev -- --port 5173 --strictPort
```

Open [http://localhost:5173](http://localhost:5173). Keep this hostname and port: the backend's current CORS configuration explicitly allows this origin. `--strictPort` prevents Vite from silently choosing another port when 5173 is occupied.

The frontend calls the backend directly; there is no Vite API proxy or environment-based API URL configured.

## Importing earthquake data

From `backend/`, run:

```sh
php bin/console app:import-earthquakes
```

The importer reads the USGS `all_day.geojson` feed, inserts new USGS IDs, updates existing records with revised values, and prints counts and a completion timestamp. A unique database index protects the USGS ID.

Imports retain older stored records; they do not remove records that have aged out of the past-day feed.

For automatic updates, run this in another backend terminal:

```sh
php bin/console app:import-earthquakes --watch
```

It imports immediately, then repeats five minutes after each run. Keep the process running; Ctrl+C stops it. Failed imports are reported and retried on the next cycle. Symfony Lock prevents overlapping imports on this machine (`LOCK_DSN=flock`). For multiple hosts, configure a shared lock store. Production can run the watcher under a process supervisor or schedule the one-shot command.

### Historical imports

Import an inclusive range of UTC calendar days from the USGS earthquake catalogue:

```sh
XDEBUG_MODE=off php bin/console app:import-earthquakes --no-debug --from=2026-09-01 --to=2026-09-30
```

Run this from `backend/`. `XDEBUG_MODE=off` suppresses Xdebug connection messages; `--no-debug` avoids development tracing overhead during backfills. Both dates are required in `YYYY-MM-DD` format. The command validates the range, requests each day in pages of up to 1,000 events, and inserts new USGS IDs or refreshes existing records. Historical mode cannot be combined with `--watch`; the watcher continues to use the past-day feed.

Progress is saved in batches of 100 records; ORM entities and debug query history are cleared after each batch. If an import fails, rerun the same command: existing records are refreshed rather than duplicated. Large ranges can take time and perform many API requests. The same import lock prevents overlap with the watcher; stop the watcher before a backfill if it holds the lock. The date filter in the browser queries stored records and does not initiate imports itself.

Catalogue documentation: [USGS earthquake web service](https://earthquake.usgs.gov/fdsnws/event/1/).

## Using the explorer

### Filters and refresh

The initial view covers the **last 24 hours**, with all magnitudes included. Choose **7 days**, **30 days**, or **Custom** for a different range. Custom From and Through values are inclusive UTC timestamps; table and popup times are displayed in your browser's local timezone.

Edit the range or minimum magnitude, then select **Apply**. Unapplied edits do not affect displayed results or automatic refresh. **Reset** restores all magnitudes and the last 24 hours and returns the table to page 1. Rolling ranges advance when filters are applied or results are refreshed; changing table pages keeps the same time boundaries.

**Auto-refresh** is enabled by default. It waits until map loading finishes, then refreshes one minute later. **Refresh** reloads the applied filters manually. The **Updated** time is the last successful table API fetch, not the last USGS import or map-loading completion.

### Map

The map loads **all earthquakes matching the applied filters**, independently of the table's page and page size. It follows API pages in batches of 100, displays loading progress, and cancels unfinished requests when filters change. Large historical ranges can take longer to load. A failed map request shows an error; use **Refresh** to retry.

Marker size represents magnitude. Depth colours distinguish shallow events (under 70 km), intermediate events (70–300 km), and deep events (300 km or more). Select a marker to open its details and USGS link. Map tiles require internet access and are attributed to OpenStreetMap.

Drag the handle below the map to adjust its height between 240 and 1,000 pixels. You can also focus the handle and use Up/Down arrows; Home and End select the minimum and maximum heights. The map redraws automatically as its size changes.

On mobile, switch between **Map** and **Table**; desktop shows both.

### Table, sorting, and selection

The toolbar **above the table** contains the visible result range (for example, `1–30 of 187 earthquakes`), **Per page**, and **Page X of Y** navigation. Result-range and pagination controls also appear below the table. Page sizes are 10, 30 (default), 50, and 100; changing the size returns to page 1 and does not change the map's results.

Select the **Magnitude**, **Time**, or **Depth** header to sort the entire filtered dataset, rather than just the visible page. New sort columns start descending; selecting the active header again switches direction. Arrows indicate the current direction and remain beside the header label. Sorting returns to page 1; the initial order is newest first.

Select a row to highlight it and its map marker, centre the map on the earthquake, and open its popup. The location button provides keyboard access to the same action. On mobile, selecting a row switches to the map. Applying filters clears the selection.

## API

Earthquake resources expose read-only collection and item operations:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/earthquakes` | Paginated earthquake collection, newest first by default. |
| `GET /api/earthquakes/{id}` | One earthquake by its database ID. |

The collection includes `member`, `totalItems`, and pagination information under `view`. The frontend uses `view.next` to enable the Next button and load subsequent map pages, and `view.last` to determine the table page count. `itemsPerPage` defaults to 30 and is capped at 100.

Example requests:

```sh
curl 'https://127.0.0.1:8000/api/earthquakes?page=1'
curl 'https://127.0.0.1:8000/api/earthquakes?magnitude%5Bgte%5D=3&page=1'
curl 'https://127.0.0.1:8000/api/earthquakes?sortDepth=asc&itemsPerPage=100'
curl 'https://127.0.0.1:8000/api/earthquakes?occurredAt%5Bafter%5D=2026-09-01T00:00:00Z&occurredAt%5Bbefore%5D=2026-09-30T23:59:59Z'
```

The second request selects earthquakes with magnitude greater than or equal to 3. The entity also configures comparison filters for depth, a date filter for `occurredAt`, and sorting parameters named `sortOccurredAt`, `sortMagnitude`, and `sortDepth`, each accepting `asc` or `desc`.

Each record contains `id`, `usgsId`, `magnitude`, `place`, `occurredAt`, `latitude`, `longitude`, and `depth`.

## Development commands

Run frontend commands from `frontend/`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite's development server. |
| `npm run build` | Type-check and generate the production frontend in `dist/`. |
| `npm run lint` | Run Oxlint. |
| `npm run preview` | Preview the built frontend locally. |

Run backend commands from `backend/`:

| Command | Purpose |
| --- | --- |
| `php bin/console app:import-earthquakes` | Import new USGS records. |
| `php bin/console doctrine:migrations:migrate` | Apply database migrations. |
| `php bin/console debug:router` | Inspect registered API routes. |
| `php bin/console lint:container` | Validate dependency injection configuration. |
| `php bin/console lint:yaml config/` | Validate YAML configuration. |
| `php vendor/bin/phpunit` | Run the existing backend tests. |

Importer coverage is available with `php vendor/bin/phpunit tests/Command`. The existing backend controller test requests `/earthquake`, which is not implemented by the current controller. It needs updating to test the API routes. No frontend test runner is currently configured.

## Configuration and deployment notes

| Setting | Location and behaviour |
| --- | --- |
| Database and app secrets | `backend/.env.local` locally; environment variables or Symfony secrets for production. |
| API URL | Hardcoded in `frontend/src/components/EarthquakeList.tsx` as `https://127.0.0.1:8000/api/earthquakes`. |
| CORS | `backend/config/packages/nelmio_cors.yaml` allows `http://localhost:5173` for API GET and OPTIONS requests. |
| Import sources | USGS past-day feed and historical catalogue query endpoint in `ImportEarthquakesCommand.php`. |
| Import lock | `LOCK_DSN=flock` by default; configure a shared store for multiple hosts. |

Although `.env` defines `CORS_ALLOW_ORIGIN`, the current CORS YAML uses a literal origin; changing that environment variable alone does not change the allowed frontend origin.

For deployment, replace the frontend's local API URL with the deployed endpoint, configure CORS for the deployed frontend origin, build the frontend, and serve the Symfony application through its `backend/public/` document root. Configure production secrets and PostgreSQL, apply migrations, and run the watcher or arrange recurring imports if you need ongoing updates. This repository currently has no application deployment configuration; the import watcher must be started or supervised separately.

## Troubleshooting

- **Empty results:** run migrations and `app:import-earthquakes`, then try the All magnitude filter.
- **Database connection fails:** verify PostgreSQL is running and that `DATABASE_URL` matches its credentials and published port. For Docker, use `docker compose port database 5432`.
- **Browser reports “Failed to fetch”:** open the HTTPS API URL directly to check certificate trust and server availability. Confirm the frontend is at `http://localhost:5173`.
- **CORS errors:** check the allowed origin in `nelmio_cors.yaml`. `localhost` and `127.0.0.1` are different browser origins.
- **Port already in use:** stop the existing server or deliberately update both the frontend endpoint and CORS settings to match any new addresses.
- **Backend errors:** inspect `backend/var/log/dev.log` and registered routes with `php bin/console debug:router`.
- **Stale results:** rerun the importer and reload the page. Use the import watcher to keep stored records updated.

## Data source

Recent data comes from the [USGS past-day GeoJSON feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson); historical imports use the USGS earthquake catalogue. The map and table reflect stored imports rather than a live stream. Changing browser dates does not automatically import missing history.
