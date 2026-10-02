import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import Supercluster from "supercluster";
import "leaflet/dist/leaflet.css";

import { magnitudeLabel, type Earthquake } from "../lib/api";
export type { Earthquake } from "../lib/api";

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
  const [zoom, setZoom] = useState(2);
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
    const onZoom = () => setZoom(instance.getZoom());
    instance.on("zoomend", onZoom);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.off("zoomend", onZoom);
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    markerIndex.current.clear();
    const markers = L.featureGroup().addTo(map.current);
    const points =
      earthquakes.length > 2000
        ? clusterIndex.getClusters([-180, -90, 180, 90], zoom)
        : [];
    const visibleQuakes: Earthquake[] =
      earthquakes.length > 2000 ? [] : [...earthquakes];
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
    if (selectedId && !visibleQuakes.some((q) => q.usgsId === selectedId)) {
      const selected = earthquakes.find((q) => q.usgsId === selectedId);
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
        detail.textContent = `${new Date(quake.occurredAt).toLocaleString()} · ${quake.depth.toFixed(2)} km deep`;
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
          quake.depth < 70
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
    if (markers.getLayers().length && fittedKey.current !== fitKey) {
      map.current.fitBounds(markers.getBounds(), {
        padding: [30, 30],
        maxZoom: 7,
      });
      fittedKey.current = fitKey;
    }
    return () => {
      markers.remove();
    };
  }, [earthquakes, fitKey, selectedId, clusterIndex, zoom]);
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
  }, [selectedId, earthquakes, zoom]);
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
        <span>● intermediate (70–300 km)</span> · <span>● deep (≥300 km)</span>.
        Select a marker for details.
      </p>
    </section>
  );
}
