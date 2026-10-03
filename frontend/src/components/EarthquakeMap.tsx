import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import Supercluster from "supercluster";
import "leaflet/dist/leaflet.css";

import { depthLabel, magnitudeLabel, type Earthquake } from "../lib/api";
export type { Earthquake } from "../lib/api";

type Viewport = { zoom: number; bbox: [number, number, number, number] };
const WORLD: Viewport = { zoom: 2, bbox: [-180, -90, 180, 90] };
const CLUSTER_ABOVE = 2000;

export default function EarthquakeMap({
  earthquakes,
  selectedId,
  fitKey = "initial",
}: {
  earthquakes: Earthquake[];
  selectedId: string | null;
  fitKey?: string;
}) {
  const [height, setHeight] = useState(() =>
    window.matchMedia("(max-width: 640px)").matches ? 320 : 420,
  );
  const [viewport, setViewport] = useState(WORLD);
  // Small result sets draw every marker once; only clustered ones follow the viewport.
  const clustered = earthquakes.length > CLUSTER_ABOVE;
  const clusterView = clustered ? viewport : null;
  const clusterSelectedId = clustered ? selectedId : null;
  const clusterIndex = useMemo(
    () =>
      new Supercluster<{ quake: Earthquake }>({ radius: 50, maxZoom: 16 }).load(
        earthquakes
          .filter(
            (q) => Number.isFinite(q.latitude) && Number.isFinite(q.longitude),
          )
          .map((quake) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [quake.longitude, quake.latitude],
            },
            properties: { quake },
          })),
      ),
    [earthquakes],
  );
  const fittedKey = useRef<string | null>(null);
  const focusedId = useRef<string | null>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const resize = (value: number) =>
    setHeight(Math.max(240, Math.min(1000, value)));
  const markerIndex = useRef(new Map<string, L.CircleMarker>());
  const highlighted = useRef<L.CircleMarker | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      preferCanvas: true,
      minZoom: 2,
      maxBounds: [
        [-85, -180],
        [85, 180],
      ],
      maxBoundsViscosity: 1,
    }).setView([20, 0], 2);
    L.tileLayer(
      import.meta.env.VITE_TILE_URL ||
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        noWrap: true,
        attribution:
          import.meta.env.VITE_TILE_ATTRIBUTION ||
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    ).addTo(instance);
    map.current = instance;
    const onMove = () => {
      const bounds = instance.getBounds();
      const [west, south, east, north] = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ];
      // Pad so markers just outside the edge are ready when panning.
      const x = (east - west) / 4;
      const y = (north - south) / 4;
      setViewport({
        zoom: instance.getZoom(),
        bbox: [
          Math.max(-180, west - x),
          Math.max(-90, south - y),
          Math.min(180, east + x),
          Math.min(90, north + y),
        ],
      });
    };
    instance.on("moveend", onMove);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.off("moveend", onMove);
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    markerIndex.current.clear();
    const markers = L.featureGroup().addTo(map.current);
    const points = clusterView
      ? clusterIndex.getClusters(clusterView.bbox, clusterView.zoom)
      : [];
    const visibleQuakes: Earthquake[] = clusterView ? [] : [...earthquakes];
    for (const point of points) {
      if ("cluster" in point.properties && point.properties.cluster) {
        const properties = point.properties;
        const location: L.LatLngExpression = [
          point.geometry.coordinates[1],
          point.geometry.coordinates[0],
        ];
        L.circleMarker(location, {
          radius: 18,
          color: "#334155",
          fillOpacity: 0.85,
          weight: 2,
        })
          .bindTooltip(
            `${properties.point_count.toLocaleString()} earthquakes — select to zoom`,
          )
          .on("click", () =>
            map.current?.setView(
              location,
              clusterIndex.getClusterExpansionZoom(properties.cluster_id),
            ),
          )
          .addTo(markers);
      } else if ("quake" in point.properties)
        visibleQuakes.push(point.properties.quake);
    }
    if (
      clusterSelectedId &&
      !visibleQuakes.some((q) => q.usgsId === clusterSelectedId)
    ) {
      const selected = earthquakes.find((q) => q.usgsId === clusterSelectedId);
      if (selected) visibleQuakes.push(selected);
    }
    for (const quake of visibleQuakes) {
      if (!Number.isFinite(quake.latitude) || !Number.isFinite(quake.longitude))
        continue;
      const popup = () => {
        const popup = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = `M ${magnitudeLabel(quake.magnitude)} — ${quake.place}`;
        const detail = document.createElement("p");
        detail.textContent = `${new Date(quake.occurredAt).toLocaleString()} · ${quake.depth === null ? depthLabel(null) : `${depthLabel(quake.depth)} deep`}`;
        const link = document.createElement("a");
        link.href = `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(quake.usgsId)}`;
        link.textContent = "View on USGS";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        popup.append(title, detail, link);
        return popup;
      };
      const tooltip = document.createElement("span");
      tooltip.textContent = `M ${magnitudeLabel(quake.magnitude)} — ${quake.place}`;
      const marker = L.circleMarker([quake.latitude, quake.longitude], {
        radius: Math.max(5, Math.min(22, (quake.magnitude ?? 1) * 3)),
        color:
          quake.depth === null
            ? "#475569"
            : quake.depth < 70
              ? "#0f766e"
              : quake.depth < 300
                ? "#b45309"
                : "#be123c",
        fillOpacity: 0.65,
        weight: 2,
      })
        .bindPopup(popup)
        .bindTooltip(tooltip)
        .addTo(markers);
      markerIndex.current.set(quake.usgsId, marker);
    }
    if (fittedKey.current !== fitKey) {
      // Fit to every result, not just the markers drawn for the current viewport.
      let [south, west, north, east] = [90, 180, -90, -180];
      let any = false;
      for (const quake of earthquakes) {
        if (
          !Number.isFinite(quake.latitude) ||
          !Number.isFinite(quake.longitude)
        )
          continue;
        any = true;
        south = Math.min(south, quake.latitude);
        north = Math.max(north, quake.latitude);
        west = Math.min(west, quake.longitude);
        east = Math.max(east, quake.longitude);
      }
      if (any) {
        map.current.fitBounds(
          [
            [south, west],
            [north, east],
          ],
          { padding: [30, 30], maxZoom: 7 },
        );
        fittedKey.current = fitKey;
      }
    }
    return () => {
      markers.remove();
    };
  }, [earthquakes, fitKey, clusterSelectedId, clusterIndex, clusterView]);
  useEffect(() => {
    if (highlighted.current)
      highlighted.current.setStyle({ weight: 2, fillOpacity: 0.65 });
    const marker = selectedId ? markerIndex.current.get(selectedId) : undefined;
    highlighted.current = marker ?? null;
    if (!marker || !map.current) {
      focusedId.current = null;
      return;
    }
    marker.setStyle({ weight: 6, fillOpacity: 1 }).bringToFront();
    if (focusedId.current !== selectedId) {
      map.current.setView(
        marker.getLatLng(),
        Math.max(map.current.getZoom(), 5),
      );
      marker.openPopup();
      focusedId.current = selectedId;
    }
  }, [selectedId, earthquakes, clusterView]);
  return (
    <section aria-label="Earthquake map">
      <div ref={container} className="earthquake-map" style={{ height }} />
      <div
        className="map-resize-handle"
        role="separator"
        tabIndex={0}
        aria-label="Resize map height"
        aria-orientation="horizontal"
        aria-valuemin={240}
        aria-valuemax={1000}
        aria-valuenow={height}
        aria-valuetext={`${height} pixels`}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { y: event.clientY, height };
        }}
        onPointerMove={(event) => {
          if (drag.current)
            resize(drag.current.height + event.clientY - drag.current.y);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          resize(
            event.key === "Home"
              ? 240
              : event.key === "End"
                ? 1000
                : height + (event.key === "ArrowDown" ? 40 : -40),
          );
        }}
      >
        <span aria-hidden="true">━━</span>
        <span>Drag to resize map</span>
      </div>
      <p className="map-legend">
        Map shows all {earthquakes.length.toLocaleString()} matching
        earthquakes. Large result sets are clustered; select a cluster to zoom.
        Size: magnitude (unknown magnitudes use a small marker). Depth:{" "}
        <span>● shallow (&lt;70 km)</span> ·{" "}
        <span>● intermediate (70–300 km)</span> · <span>● deep (≥300 km)</span>{" "}
        · <span>● unknown</span>. Select a marker for details.
      </p>
    </section>
  );
}
