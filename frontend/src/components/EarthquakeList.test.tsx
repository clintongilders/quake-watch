import {
  act,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "../test/render";
import EarthquakeList from "./EarthquakeList";
import type { Earthquake } from "./EarthquakeMap";

// Leaflet rendering is tested separately; expose the list's map data and selection.
vi.mock("./EarthquakeMap", () => ({
  default: ({
    earthquakes,
    selectedId,
  }: {
    earthquakes: Earthquake[];
    selectedId: string | null;
  }) => (
    <div data-testid="map" data-selected={selectedId ?? ""}>
      {earthquakes.map((q) => q.usgsId).join(",")}
    </div>
  ),
}));
const quake = (id: string): Earthquake => ({
  id: 1,
  usgsId: id,
  magnitude: 3,
  place: `Location ${id}`,
  depth: 10,
  latitude: 49,
  longitude: -123,
  occurredAt: "2026-09-02T12:00:00Z",
});
const requests: URL[] = [];
const reply = (member: Earthquake[], totalItems = member.length, view = {}) =>
  new Response(JSON.stringify({ member, totalItems, view }), { status: 200 });
const mapReply = (earthquakes: Earthquake[]) =>
  new Response(
    JSON.stringify({
      type: "FeatureCollection",
      totalItems: earthquakes.length,
      truncated: false,
      features: earthquakes.map((q) => ({
        type: "Feature",
        id: q.usgsId,
        geometry: {
          type: "Point",
          coordinates: [q.longitude, q.latitude, q.depth],
        },
        properties: {
          magnitude: q.magnitude,
          place: q.place,
          occurredAt: q.occurredAt,
        },
      })),
    }),
    { status: 200 },
  );
let mapCalls = 0;

beforeEach(() => {
  requests.length = 0;
  mapCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith("/map")) {
        mapCalls++;
        return mapReply([quake("a"), quake("b")]);
      }
      return reply(
        [quake(url.searchParams.get("page") === "2" ? "b" : "a")],
        31,
        {
          last: "/api/earthquakes?page=2",
          ...(url.searchParams.get("page") !== "2"
            ? { next: "/api/earthquakes?page=2" }
            : {}),
        },
      );
    }),
  );
});
async function ready() {
  await screen.findByTestId("map");
  await screen.findByRole("button", { name: "Show Location a on map" });
}
const tableRequests = () =>
  requests.filter(
    (url) =>
      url.searchParams.has("sortOccurredAt") ||
      url.searchParams.has("sortMagnitude") ||
      url.searchParams.has("sortDepth"),
  );

it("defaults to 24 hours and loads all map results in one request", async () => {
  render(<EarthquakeList />);
  await ready();
  expect(screen.getByRole("radio", { name: "Last 24 hours" })).toBeChecked();
  const query = tableRequests()[0].searchParams;
  expect(
    Date.parse(query.get("occurredAt[before]")!) -
      Date.parse(query.get("occurredAt[after]")!),
  ).toBe(86400000);
  expect(query.get("itemsPerPage")).toBe("30");
  expect(screen.getByTestId("map")).toHaveTextContent("a,b");
  expect(mapCalls).toBe(1);
});

it("paginates and changes page size without reloading the map or moving date boundaries", async () => {
  const user = userEvent.setup();
  render(<EarthquakeList />);
  await ready();
  const before = tableRequests()[0].searchParams.get("occurredAt[after]");
  await user.click(
    within(
      screen.getByRole("navigation", { name: "Top earthquake pagination" }),
    ).getByRole("button", { name: "Next" }),
  );
  await screen.findByRole("button", { name: "Show Location b on map" });
  expect(tableRequests().at(-1)?.searchParams.get("page")).toBe("2");
  expect(tableRequests().at(-1)?.searchParams.get("occurredAt[after]")).toBe(
    before,
  );
  await user.selectOptions(screen.getByLabelText("Results per page"), "50");
  await screen.findByRole("button", { name: "Show Location a on map" });
  expect(tableRequests().at(-1)?.searchParams.get("itemsPerPage")).toBe("50");
  expect(tableRequests().at(-1)?.searchParams.get("page")).toBe("1");
  expect(mapCalls).toBe(1);
});

it.each([
  ["Magnitude", "sortMagnitude"],
  ["Time", "sortOccurredAt"],
  ["Depth", "sortDepth"],
])("sorts %s in both directions", async (label, parameter) => {
  const user = userEvent.setup();
  render(<EarthquakeList />);
  await ready();
  await user.click(screen.getByRole("button", { name: label }));
  const firstDirection = label === "Time" ? "asc" : "desc";
  await waitFor(() =>
    expect(tableRequests().at(-1)?.searchParams.get(parameter)).toBe(
      firstDirection,
    ),
  );
  await user.click(screen.getByRole("button", { name: label }));
  await waitFor(() =>
    expect(tableRequests().at(-1)?.searchParams.get(parameter)).toBe(
      firstDirection === "asc" ? "desc" : "asc",
    ),
  );
  expect(mapCalls).toBe(1);
});

it("applies draft magnitude filters only on submit and resets selection and filters", async () => {
  const user = userEvent.setup();
  render(<EarthquakeList />);
  await ready();
  await user.click(
    screen.getByRole("button", { name: "Show Location a on map" }),
  );
  expect(screen.getByTestId("map")).toHaveAttribute("data-selected", "a");
  const count = requests.length;
  await user.selectOptions(screen.getByLabelText("Magnitude"), "4");
  expect(requests).toHaveLength(count);
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await ready();
  expect(tableRequests().at(-1)?.searchParams.get("magnitude[gte]")).toBe("4");
  expect(screen.getByTestId("map")).toHaveAttribute("data-selected", "");
  await user.click(screen.getByRole("button", { name: "Reset" }));
  await ready();
  expect(tableRequests().at(-1)?.searchParams.has("magnitude[gte]")).toBe(
    false,
  );
});

it("prefills custom dates with 24 hours and prevents reversed ranges", async () => {
  const user = userEvent.setup();
  render(<EarthquakeList />);
  await ready();
  await user.click(screen.getByRole("radio", { name: "Custom" }));
  const from = screen.getByLabelText("From") as HTMLInputElement;
  const through = screen.getByLabelText("Through") as HTMLInputElement;
  expect(Date.parse(through.value + "Z") - Date.parse(from.value + "Z")).toBe(
    86400000,
  );
  fireEvent.input(from, { target: { value: "2026-09-01T00:00:00" } });
  fireEvent.input(through, { target: { value: "2026-09-02T00:00:00" } });
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await ready();
  expect(
    Date.parse(tableRequests().at(-1)!.searchParams.get("occurredAt[after]")!),
  ).toBe(Date.parse("2026-09-01T00:00:00Z"));
  fireEvent.input(from, { target: { value: "2026-09-03T00:00:00" } });
  expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "From on or before Through",
  );
});

it("reports map HTTP errors while keeping the table usable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) =>
      new URL(String(input)).pathname.endsWith("/map")
        ? new Response("", { status: 503 })
        : reply([quake("a")]),
    ),
  );
  render(<EarthquakeList />);
  await screen.findByRole("button", { name: "Show Location a on map" });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load map results: Request failed: 503",
  );
});

it("rejects malformed map responses at the API boundary", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) =>
      new URL(String(input)).pathname.endsWith("/map")
        ? reply([quake("a")])
        : reply([quake("a")]),
    ),
  );
  render(<EarthquakeList />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to load map results:",
  );
});

it("reports table errors and can refresh successfully", async () => {
  const user = userEvent.setup();
  let failing = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/map")
        ? mapReply([quake("a")])
        : failing
          ? new Response("", { status: 500 })
          : reply([quake("a")]);
    }),
  );
  render(<EarthquakeList />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Error: Request failed: 500",
  );
  failing = false;
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await ready();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows empty results without disabling the filters", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) =>
      new URL(String(input)).pathname.endsWith("/map")
        ? mapReply([])
        : reply([]),
    ),
  );
  render(<EarthquakeList />);
  expect(
    await screen.findByText("No earthquakes match these filters."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  expect(screen.getByTestId("map")).toBeEmptyDOMElement();
});

it("aborts in-flight requests when unmounted", () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, init: RequestInit) => {
      signals.push(init.signal!);
      return new Promise(() => {});
    }),
  );
  const { unmount } = render(<EarthquakeList />);
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => !signal.aborted)).toBe(true);
  unmount();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

it("auto-refreshes at 60 seconds and stops when disabled", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  render(<EarthquakeList />);
  await ready();
  const count = requests.length;
  const through = tableRequests()[0].searchParams.get("occurredAt[before]");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(requests.length).toBeGreaterThan(count);
  expect(
    Date.parse(
      tableRequests().at(-1)!.searchParams.get("occurredAt[before]")!,
    ) - Date.parse(through!),
  ).toBe(60000);
  fireEvent.click(screen.getByRole("checkbox", { name: "Auto-refresh" }));
  const disabledCount = requests.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(requests).toHaveLength(disabledCount);
});

it("restores filters, sorting and pagination from a shared URL", async () => {
  window.history.replaceState(
    null,
    "",
    "/?range=7d&magnitude=4&sort=Depth&direction=asc&perPage=10&page=2",
  );
  render(<EarthquakeList />);
  await screen.findByRole("button", { name: "Show Location b on map" });
  const q = tableRequests()[0].searchParams;
  expect(q.get("magnitude[gte]")).toBe("4");
  expect(q.get("sortDepth")).toBe("asc");
  expect(q.get("page")).toBe("2");
  expect(q.get("itemsPerPage")).toBe("10");
  expect(
    Date.parse(q.get("occurredAt[before]")!) -
      Date.parse(q.get("occurredAt[after]")!),
  ).toBe(7 * 86400000);
});

it("displays unknown magnitudes and warns when the map response is capped", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      if (new URL(String(input)).pathname.endsWith("/map")) {
        const payload = await mapReply([
          { ...quake("a"), magnitude: null },
        ]).json();
        return new Response(
          JSON.stringify({ ...payload, totalItems: 60000, truncated: true }),
        );
      }
      return reply([{ ...quake("a"), magnitude: null }]);
    }),
  );
  render(<EarthquakeList />);
  await ready();
  expect(screen.getByText("Unknown")).toBeVisible();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Narrow the filters",
  );
});
