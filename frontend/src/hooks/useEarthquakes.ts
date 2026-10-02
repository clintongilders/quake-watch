import { useEffect, useReducer, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiUrl, fetchCollection, fetchMap } from "../lib/api";

export type Range = "24h" | "7d" | "30d" | "custom";
export interface Filters {
  range: Range;
  magnitude: string;
  from: string;
  through: string;
}
type Sort = {
  column: "Magnitude" | "OccurredAt" | "Depth";
  direction: "asc" | "desc";
};
interface State {
  filters: Filters;
  draft: Filters;
  page: number;
  pageSize: number;
  sort: Sort;
  selectedId: string | null;
  mobileView: "map" | "table";
}
export function defaults(): Filters {
  const now = new Date();
  return {
    range: "24h",
    magnitude: "",
    from: new Date(now.getTime() - 86400000).toISOString().slice(0, 19),
    through: now.toISOString().slice(0, 19),
  };
}
function initial(): State {
  const q = new URLSearchParams(window.location.search);
  const base = defaults();
  const range = q.get("range");
  if (
    range === "24h" ||
    range === "7d" ||
    range === "30d" ||
    range === "custom"
  )
    base.range = range;
  if (["2", "3", "4", "5"].includes(q.get("magnitude") || ""))
    base.magnitude = q.get("magnitude")!;
  const validDate = (value: string | null) =>
    value !== null &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) &&
    Number.isFinite(Date.parse(value + "Z"));
  if (base.range === "custom") {
    if (
      validDate(q.get("from")) &&
      validDate(q.get("through")) &&
      q.get("from")! <= q.get("through")!
    ) {
      base.from = q.get("from")!;
      base.through = q.get("through")!;
    } else base.range = "24h";
  }
  const column = q.get("sort");
  const size = Number(q.get("perPage"));
  return {
    filters: base,
    draft: base,
    page: Math.max(1, Math.floor(Number(q.get("page"))) || 1),
    pageSize: [10, 30, 50, 100].includes(size) ? size : 30,
    sort: {
      column:
        column === "Magnitude" || column === "Depth" ? column : "OccurredAt",
      direction: q.get("direction") === "asc" ? "asc" : "desc",
    },
    selectedId: null,
    mobileView: "map",
  };
}
type Action =
  | { type: "draft"; value: Filters }
  | { type: "apply"; value: Filters }
  | { type: "page"; value: number }
  | { type: "size"; value: number }
  | { type: "sort"; value: Sort["column"] }
  | { type: "select"; value: string }
  | { type: "view"; value: State["mobileView"] }
  | { type: "restore"; value: State };
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "draft":
      return { ...state, draft: action.value };
    case "apply":
      return {
        ...state,
        filters: { ...action.value },
        draft: { ...action.value },
        page: 1,
        selectedId: null,
      };
    case "page":
      return { ...state, page: action.value };
    case "size":
      return { ...state, pageSize: action.value, page: 1 };
    case "sort":
      return {
        ...state,
        page: 1,
        sort: {
          column: action.value,
          direction:
            state.sort.column === action.value &&
            state.sort.direction === "desc"
              ? "asc"
              : "desc",
        },
      };
    case "select":
      return { ...state, selectedId: action.value, mobileView: "map" };
    case "view":
      return { ...state, mobileView: action.value };
    case "restore":
      return action.value;
  }
}
export function useEarthquakes() {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [snapshot, setSnapshot] = useState(
    () => Math.floor(Date.now() / 60000) * 60000,
  );
  const { filters, page, pageSize, sort } = state;
  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    q.set("range", filters.range);
    if (filters.magnitude) q.set("magnitude", filters.magnitude);
    else q.delete("magnitude");
    for (const key of ["from", "through"] as const) {
      if (filters.range === "custom") q.set(key, filters[key]);
      else q.delete(key);
    }
    q.set("page", String(page));
    q.set("perPage", String(pageSize));
    q.set("sort", sort.column);
    q.set("direction", sort.direction);
    window.history.replaceState(null, "", url);
  }, [filters, page, pageSize, sort]);
  useEffect(() => {
    const restore = () => dispatch({ type: "restore", value: initial() });
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const filterParams = new URLSearchParams();
  if (filters.magnitude) filterParams.set("magnitude[gte]", filters.magnitude);
  const days = filters.range === "7d" ? 7 : filters.range === "30d" ? 30 : 1;
  filterParams.set(
    "occurredAt[after]",
    filters.range === "custom"
      ? filters.from + "Z"
      : new Date(snapshot - days * 86400000).toISOString(),
  );
  filterParams.set(
    "occurredAt[before]",
    filters.range === "custom"
      ? filters.through + "Z"
      : new Date(snapshot).toISOString(),
  );
  const tableUrl = apiUrl("/api/earthquakes");
  tableUrl.search = filterParams.toString();
  tableUrl.searchParams.set(`sort${sort.column}`, sort.direction);
  tableUrl.searchParams.set("page", String(page));
  tableUrl.searchParams.set("itemsPerPage", String(pageSize));
  const mapUrl = apiUrl("/api/earthquakes/map");
  mapUrl.search = filterParams.toString();
  const table = useQuery({
    queryKey: ["earthquakes", tableUrl.toString()],
    queryFn: ({ signal }) => fetchCollection(tableUrl, signal),
    placeholderData: keepPreviousData,
    staleTime: 60000,
  });
  const map = useQuery({
    queryKey: ["map", mapUrl.toString()],
    queryFn: async ({ signal }) => ({
      ...(await fetchMap(mapUrl, signal)),
      fitKey: JSON.stringify(filters),
    }),
    placeholderData: keepPreviousData,
    staleTime: 60000,
  });
  const tableFetching = table.isFetching;
  const mapFetching = map.isFetching;
  const refetchTable = table.refetch;
  const refetchMap = map.refetch;
  useEffect(() => {
    if (!autoRefresh || tableFetching || mapFetching) return;
    const timer = window.setInterval(() => {
      setSnapshot(Math.floor(Date.now() / 60000) * 60000);
      if (filters.range === "custom") {
        void refetchTable();
        void refetchMap();
      }
    }, 60000);
    return () => window.clearInterval(timer);
  }, [
    autoRefresh,
    tableFetching,
    mapFetching,
    filters.range,
    refetchTable,
    refetchMap,
  ]);
  const totalItems = table.data?.totalItems ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  useEffect(() => {
    if (table.data && !table.isPlaceholderData && page > totalPages)
      dispatch({ type: "page", value: totalPages });
  }, [table.data, table.isPlaceholderData, page, totalPages]);
  function refresh() {
    const next = Math.floor(Date.now() / 60000) * 60000;
    if (next === snapshot || filters.range === "custom") {
      void table.refetch();
      void map.refetch();
    }
    setSnapshot(next);
  }
  function applyFilters(value: Filters) {
    setSnapshot(Math.floor(Date.now() / 60000) * 60000);
    dispatch({ type: "apply", value });
  }
  return {
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
  };
}
