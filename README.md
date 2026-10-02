# Quake Watch

Quake Watch is an earthquake explorer built with React, TypeScript, and a Symfony API. It imports earthquake records from the USGS past-day GeoJSON feed into PostgreSQL and displays them in a paginated table.

## Features

- View earthquake magnitude, location, occurrence time, and depth in kilometres.
- Filter by minimum magnitude: All, 2+, 3+, 4+, or 5+.
- Navigate results with Previous and Next controls.
- Explore the current page on an interactive map, with magnitude-sized markers, depth colours, and USGS detail links.
- Filter by a UTC date range and refresh results automatically every minute.
- Browse records newest first, with times displayed in the browser's local timezone.
- See loading, error, and empty-result states.

The API also exposes coordinates and supports magnitude, depth, date, and sorting filters. Run the import watcher for automatic USGS updates every five minutes. The browser refreshes API results every minute; you can pause this or refresh manually.

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
  src/components/EarthquakeList.tsx        Results, filters, and pagination
  vite.config.ts                          Vite development configuration
```

The backend uses Symfony 8.1, API Platform 5, and Doctrine ORM. The frontend uses React 19, TypeScript 6, Vite 8, and Oxlint.

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

The browser's “Results fetched” time records its last successful API fetch, not the last USGS import. Date boundaries are inclusive UTC days. The map and table show the same page, not all matching earthquakes. Map tiles require internet access and are attributed to OpenStreetMap.

## API

Earthquake resources expose read-only collection and item operations:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/earthquakes` | Paginated earthquake collection, newest first by default. |
| `GET /api/earthquakes/{id}` | One earthquake by its database ID. |

The collection includes `member`, `totalItems`, and pagination information under `view`. The frontend uses `view.next` to enable the Next button.

Example requests:

```sh
curl 'https://127.0.0.1:8000/api/earthquakes?page=1'
curl 'https://127.0.0.1:8000/api/earthquakes?magnitude%5Bgte%5D=3&page=1'
```

The second request selects earthquakes with magnitude greater than or equal to 3. The entity also configures comparison filters for depth, a date filter for `occurredAt`, and sorting parameters named `sortOccurredAt` and `sortMagnitude`.

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
| Import source | USGS past-day feed URL in `ImportEarthquakesCommand.php`. |

Although `.env` defines `CORS_ALLOW_ORIGIN`, the current CORS YAML uses a literal origin; changing that environment variable alone does not change the allowed frontend origin.

For deployment, replace the frontend's local API URL with the deployed endpoint, configure CORS for the deployed frontend origin, build the frontend, and serve the Symfony application through its `backend/public/` document root. Configure production secrets and PostgreSQL, apply migrations, and arrange recurring imports if you need ongoing updates. This repository currently has no application deployment configuration; the import watcher must be started or supervised separately.

## Troubleshooting

- **Empty results:** run migrations and `app:import-earthquakes`, then try the All magnitude filter.
- **Database connection fails:** verify PostgreSQL is running and that `DATABASE_URL` matches its credentials and published port. For Docker, use `docker compose port database 5432`.
- **Browser reports “Failed to fetch”:** open the HTTPS API URL directly to check certificate trust and server availability. Confirm the frontend is at `http://localhost:5173`.
- **CORS errors:** check the allowed origin in `nelmio_cors.yaml`. `localhost` and `127.0.0.1` are different browser origins.
- **Port already in use:** stop the existing server or deliberately update both the frontend endpoint and CORS settings to match any new addresses.
- **Backend errors:** inspect `backend/var/log/dev.log` and registered routes with `php bin/console debug:router`.
- **Stale results:** rerun the importer and reload the page. Use the import watcher to keep stored records updated.

## Data source

Earthquake data is imported from the [USGS past-day GeoJSON feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson). The table reflects stored imports rather than a live stream.
