# QuakeWatch

An earthquake explorer built with React 19, TypeScript, Symfony 8.1, API Platform 5, Doctrine, and PostgreSQL. Imports USGS observations into a local catalogue and displays them on a map and a sortable table.

## Features

- Last 24 hours by default; 7 days, 30 days, or inclusive custom UTC timestamps.
- Apply/reset minimum-magnitude filters; unknown magnitudes and depths are shown as **Unknown**, rather than zero.
- Sort the complete filtered dataset by magnitude, time, or depth. Table pagination is independent of the map.
- Select a table row or its keyboard-accessible location button to highlight the quake and open map details.
- One GeoJSON request for map results, with clustering above 2,000 events. Map refresh preserves pan, zoom, selection, and canvas height.
- Resize the map by dragging or using the handle's Up/Down, Home, and End keys (240–1,000 pixels).
- Share or bookmark filters, sorting, page size, and page via the URL.
- Automatic refresh every minute after current requests finish, with cancellation, caching, retry, and manual refresh.

Data reflects completed imports, not a live stream. Changing browser filters does not import missing history. Table and popup times use your browser's timezone; custom filter values and stored timestamps are UTC.

## Development setup

Requirements: PHP 8.4.1+, Composer, Node 24, npm, PostgreSQL 16, and Symfony CLI. PHP needs PDO PostgreSQL, intl, mbstring, and a 256 MB memory limit for large map responses; local SQLite tests also need PDO SQLite. Imports and map tiles require internet access.

```sh
git clone git@github.com:clintongilders/quake-watch.git
cd quake-watch/backend
composer install
composer check-platform-reqs
```

Create `backend/.env.local` (ignored by Git):

```dotenv
APP_ENV=dev
APP_SECRET=replace_with_a_random_secret
DATABASE_URL="postgresql://app:your_password@127.0.0.1:5432/app?serverVersion=16&charset=utf8"
```

Generate the secret with `openssl rand -hex 32`. URL-encode database passwords. Committed environment files contain defaults only; set real secrets locally or through production environment variables.

With an existing PostgreSQL server, run `php bin/console doctrine:database:create --if-not-exists`. Alternatively, from **backend/** use the development database Compose file:

```sh
docker compose up -d database
docker compose port database 5432
```

That development container uses database/user `app`, password `!ChangeMe!`, and a dynamically published port. Put the reported port in `DATABASE_URL`. The root Compose file is a separate production-style application stack.

From **backend/**:

```sh
php bin/console doctrine:migrations:migrate --no-interaction
php bin/console app:import-earthquakes
symfony server:ca:install
symfony serve -d --port=8000
```

From **frontend/** in another terminal:

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

Open [localhost:5173](http://localhost:5173). Vite proxies `/api` to the local Symfony HTTPS server; `secure: false` is limited to this development proxy. Browser requests are same-origin and need no CORS configuration. Stop Symfony with `symfony server:stop`.

`frontend/.env.example` documents optional **build-time, public** settings:

- `VITE_API_URL`: backend origin for a separately hosted API. Empty uses same-origin `/api`.
- `VITE_TILE_URL` and `VITE_TILE_ATTRIBUTION`: raster provider URL and required attribution. Never put private credentials in Vite variables.

For direct cross-origin hosting, set backend `CORS_ALLOW_ORIGIN` to an anchored regex for your frontend origin, for example `^https://quakes\.example\.com$`. This environment variable is wired into Nelmio CORS.

## Importing and scheduling

Run from **backend/**:

```sh
XDEBUG_MODE=off php bin/console app:import-earthquakes --no-debug
XDEBUG_MODE=off php bin/console app:import-earthquakes --no-debug --from=2026-09-01 --to=2026-09-30
```

Historical dates are required together, validated, and inclusive UTC calendar days. The catalogue is requested in pages of 1,000. Live imports normally use USGS's past-day feed; both paths accept only `type=earthquake`. Missing magnitudes remain null. Invalid features are skipped and counted. Records are saved in atomic batches of 100 using PostgreSQL `ON CONFLICT`, so rerunning an interrupted range updates existing USGS IDs rather than duplicating them. SQL profiling is disabled in Doctrine configuration, avoiding development query-history retention.

A successful live import stores its **start time** in `import_checkpoint`. If the next run is more than a day later, it backfills the gap with an overlapping UTC day before fetching the live feed. Failed runs do not advance the checkpoint. Historical imports do not advance it either. The first run has no checkpoint and imports the past day; import any older desired range explicitly.

`--watch` has been removed. Schedule a fresh PHP process every five minutes, so failure in one run cannot poison the next. For example, add a cron entry with the actual project and PHP paths:

```cron
*/5 * * * * cd /absolute/path/quake-watch/backend && APP_ENV=prod APP_DEBUG=0 /usr/bin/php bin/console app:import-earthquakes --no-interaction >> var/log/import.log 2>&1
```

Ensure the scheduled process receives `DATABASE_URL` and `APP_SECRET`; do not put secrets into a committed crontab. Rotate the log. A lock prevents overlapping imports; a busy run skips successfully. `LOCK_DSN=flock` works on one host. The application Compose stack shares `flock:///app/var/locks` between containers. Multiple hosts require a shared Symfony-supported lock store.

**Existing data:** the migration does not guess which old zeros meant unknown, or which historical timestamps used a non-UTC PHP timezone. Reimport the affected historical range to refresh those values from USGS. It also cannot identify older non-earthquake records whose source type was never stored; reconcile those against USGS before deleting them. Records are not deleted merely because they age out of the live feed. When USGS merges network reports and changes an event's preferred ID, the import replaces the rows stored under its previous IDs.

USGS catalogue documentation: [earthquake web service](https://earthquake.usgs.gov/fdsnws/event/1/).

## API

| Endpoint | Response |
| --- | --- |
| `GET /api/earthquakes` | Read-only paginated JSON-LD collection: `member`, `totalItems`, `view`. |
| `GET /api/earthquakes/{id}` | One record by database ID. |
| `GET /api/earthquakes/map` | GeoJSON FeatureCollection with `totalItems` and `truncated`. |

Collection fields: `id`, `usgsId`, nullable `magnitude`, `place`, `occurredAt`, `latitude`, `longitude`, nullable `depth`. Unknown values are sent as explicit `null` and sort last in either direction. Table page size defaults to 30, capped at 100. Filters include `magnitude[gte]`, depth comparisons, and `occurredAt[after]`/`[before]`. Sort parameters `sortMagnitude`, `sortOccurredAt`, and `sortDepth` accept `asc` or `desc`.

The map accepts `magnitude[gte]`, inclusive ISO-8601 `occurredAt[after]`/`[before]` with timezones, and optional `south`, `north`, `west`, `east` bounds. Split bounding boxes crossing the antimeridian. Feature coordinates are `[longitude, latitude, depth]` (depth may be `null`); properties are magnitude, place, and UTC occurredAt. It returns up to **50,000** events, with a visible warning to narrow filters if the results are capped. This bound protects server/browser memory; the table can still paginate all matching records. Ordinary 24-hour and 30-day views load the full map dataset in one request.

Map responses use 60-second public HTTP caching and ETags/conditional requests. API Platform collection/item responses have 60-second cache headers. PostgreSQL indexes cover occurrence time plus magnitude, magnitude, and depth. The frontend validates API responses with Zod rather than trusting handwritten casts.

```sh
curl 'https://127.0.0.1:8000/api/earthquakes?magnitude%5Bgte%5D=3&sortDepth=asc'
curl 'https://127.0.0.1:8000/api/earthquakes/map?south=40&north=60&west=-130&east=-110'
```

## Tests and tooling

From **frontend/**:

```sh
npm test
npm run test:coverage
npm run lint
npm run format:check
npm run build
```

`npm run test:watch` watches tests; `npm run format` formats source. Vitest/Testing Library tests cover filters, URL restoration, sorting/pagination, null magnitudes, API validation, cancellation, refresh, selection, clustering, popup safety, bounds, and resizing. Leaflet calls are mocked; browser rendering and real tiles still need manual checks. Coverage includes components, query hooks, and API code, with thresholds of 85% lines, 80% statements, and 70% branches/functions. Report: `frontend/coverage/index.html`.

From **backend/**:

```sh
XDEBUG_MODE=off composer test
XDEBUG_MODE=off composer analyse
XDEBUG_MODE=off composer format:check
XDEBUG_MODE=coverage php vendor/bin/phpunit --coverage-html var/coverage
APP_ENV=prod APP_DEBUG=0 php bin/console lint:container
```

`composer format` applies Symfony formatting. PHPStan uses Symfony/Doctrine extensions. Database configuration comes from `TEST_DATABASE_URL` in the test environment, never hand-mutated environment globals. The local default is in-memory SQLite; the real database constraint-recovery test is skipped there. To run **all** tests against PostgreSQL, create a disposable database whose name ends in `_test`:

```sh
TEST_DATABASE_URL='postgresql://user:password@127.0.0.1:5432/quakewatch_test?serverVersion=16' XDEBUG_MODE=off composer test
```

Tests recreate their mapped tables and clear the application cache. Never point them at development or production data. PostgreSQL test databases must end in `_test`; SQLite must be in-memory. USGS HTTP responses are fixtures, while import writes, rollback, checkpoint recovery, API filtering, and sorting use the actual database. Coverage report: `backend/var/coverage/index.html`.

GitHub Actions runs migrations and schema validation, PostgreSQL 16 integration tests, PHPStan, format checks, production container validation, frontend checks, coverage thresholds, both Docker image builds, and HTTP smoke tests through nginx. CI executes when these changes are pushed; a local pass does not claim a remote CI pass.

## PHP step debugging in VS Code

The local `development` VS Code workspace has debug configurations in its `.vscode/launch.json`. Open `development.code-workspace` to use them. The required extension is **PHP Debug** (`xdebug.php-debug`). PHP CLI and the Symfony PHP-FPM server must both load Xdebug with `xdebug.mode=debug`; Xdebug connects to the editor on port **9003**.

### Debug API requests

1. Set a breakpoint in `backend/public/index.php` on the `require_once` line. API Platform handles collection/item routes; `EarthquakeMapController` handles the GeoJSON map endpoint.
2. In **Run and Debug**, choose **QuakeWatch: Listen for Xdebug**, then press **F5**.
3. Request `https://127.0.0.1:8000/api/earthquakes` or refresh the frontend. The local PHP configuration currently starts debugging on every request, so the frontend's multiple API requests can create several debug sessions. Turn off Auto-refresh while debugging.
4. Use **F10** to step over, **F11** to step into, **Shift+F11** to step out, and **F5** to continue.

### Debug the importer

Set a breakpoint inside `ImportEarthquakesCommand::execute()` or `EarthquakeWriter::write()`, choose **QuakeWatch: Debug earthquake import**, and press **F5**. This launches the one-shot recent import and pauses at entry; continuing runs the import against the configured database. Edit the launch configuration's `args` to debug a historical range.

Do not use `XDEBUG_MODE=off` for a debugging session. The CLI launch configuration explicitly enables Xdebug. A “Could not connect to debugging client” message means Xdebug tried to contact the editor but no matching listener was available. Start the listener before issuing the request, and ensure port 9003 is available. Local PHP source paths match editor paths, so no path mapping is required.

To debug only selected requests instead of every request, change your PHP configuration to `xdebug.start_with_request=trigger`, restart the Symfony server, and use `XDEBUG_TRIGGER=1` for CLI commands or `?XDEBUG_TRIGGER=1` on API URLs. This is an optional machine-level setting; the project does not change it automatically.

## Production containers

The root `compose.yaml` runs PostgreSQL 16, a PHP-FPM backend, nginx with the built frontend and same-origin API routing, and an importer that launches a **fresh process** each cycle.

Export secrets before running (do not commit them):

```sh
export APP_SECRET="$(openssl rand -hex 32)"
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
docker compose build
docker compose up -d database backend
docker compose exec backend php bin/console doctrine:migrations:migrate --no-interaction
docker compose up -d frontend importer
```

Open `http://localhost:8080`. Migration runs are explicit and must precede starting the importer. `APP_ENV=prod` and `APP_DEBUG=0` are set by the stack. The PostgreSQL volume and the shared import-lock volume survive container restarts; the compiled Symfony cache lives in the container and is rebuilt with each new image. Do not run `docker compose down -v` against data you want to keep.

For public hosting, terminate HTTPS at a reverse proxy, provision backups, supply secrets through the hosting environment, and choose tile service settings appropriate to your traffic. `VITE_TILE_URL`/`VITE_TILE_ATTRIBUTION` are frontend build arguments in Compose; changing them requires a rebuild. Same-origin hosting needs no cross-origin configuration. Separate API hosting also needs `VITE_API_URL` at build time and a restrictive `CORS_ALLOW_ORIGIN` on the backend.

OpenStreetMap's public tiles permit ordinary interactive use under their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/), including attribution, normal browser caching, and a valid Referer. They provide no SLA and prohibit bulk/offline downloading. Use a suitable alternative when your deployment needs guaranteed capacity; this app allows switching providers.

## Project structure

```text
backend/src/Command/ImportEarthquakesCommand.php  Validates/fetches USGS records
backend/src/Service/EarthquakeWriter.php         Atomic batch upserts and checkpoints
backend/src/Controller/EarthquakeMapController.php  Slim map endpoint
backend/src/Dto/MapFilters.php                   Validated map request parameters
backend/src/Entity/                              Read-only API model and checkpoint
backend/migrations/                             PostgreSQL schema evolution
frontend/src/hooks/useEarthquakes.ts             Reducer, URL state and query lifecycle
frontend/src/lib/api.ts                          URLs, contracts and response validation
frontend/src/components/                        Explorer UI and clustered Leaflet map
.github/workflows/ci.yml                        Automated checks and image builds
compose.yaml                                    Full application stack
```

## Troubleshooting

- **Empty results:** apply migrations, import records, and check the UTC range and magnitude filter.
- **Database unavailable:** verify PostgreSQL and `DATABASE_URL`. The backend development Compose file uses a dynamic host port.
- **Vite API errors:** verify Symfony is running at the proxy target in `frontend/vite.config.ts`; direct API access may require trusting Symfony's local certificate.
- **CORS errors with a separate API:** check `CORS_ALLOW_ORIGIN`. Hostnames and ports are part of the origin.
- **Stale results:** run the importer; browser/API caches may retain data for up to 60 seconds.
- **Large map range:** narrow filters when the 50,000-event cap is reached; use table pagination for the complete catalogue.
- **Removed watch option:** use the scheduled one-shot command or the Compose importer.
- **Old values:** rerun historical import for the affected dates rather than guessing timezone offsets or converting every zero magnitude to null.
