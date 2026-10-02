import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface Earthquake {
  id: number; usgsId: string; magnitude: number; place: string;
  occurredAt: string; latitude: number; longitude: number; depth: number;
}

export default function EarthquakeMap({ earthquakes, selectedId }: { earthquakes: Earthquake[]; selectedId: string | null }) {
  const [height, setHeight] = useState(() => window.matchMedia('(max-width: 640px)').matches ? 320 : 420);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const resize = (value: number) => setHeight(Math.max(240, Math.min(1000, value)));
  const markerIndex = useRef(new Map<string, L.CircleMarker>());
  const highlighted = useRef<L.CircleMarker | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      preferCanvas: true,
      minZoom: 2,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1,
    }).setView([20, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, noWrap: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    map.current = instance;
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    markerIndex.current.clear();
    const markers = L.featureGroup().addTo(map.current);
    for (const quake of earthquakes) {
      if (!Number.isFinite(quake.latitude) || !Number.isFinite(quake.longitude)) continue;
      const popup = () => {
        const popup = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `M ${quake.magnitude.toFixed(2)} — ${quake.place}`;
        const detail = document.createElement('p');
        detail.textContent = `${new Date(quake.occurredAt).toLocaleString()} · ${quake.depth.toFixed(2)} km deep`;
        const link = document.createElement('a');
        link.href = `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(quake.usgsId)}`;
        link.textContent = 'View on USGS'; link.target = '_blank'; link.rel = 'noopener noreferrer';
        popup.append(title, detail, link);
        return popup;
      };
      const marker = L.circleMarker([quake.latitude, quake.longitude], {
        radius: Math.max(5, Math.min(22, quake.magnitude * 3)),
        color: quake.depth < 70 ? '#0f766e' : quake.depth < 300 ? '#b45309' : '#be123c',
        fillOpacity: 0.65, weight: 2,
      }).bindPopup(popup).bindTooltip(`M ${quake.magnitude.toFixed(2)} — ${quake.place}`).addTo(markers);
      markerIndex.current.set(quake.usgsId, marker);
    }
    if (markers.getLayers().length) map.current.fitBounds(markers.getBounds(), { padding: [30, 30], maxZoom: 7 });
    return () => { markers.remove(); };
  }, [earthquakes]);
  useEffect(() => {
    if (highlighted.current) highlighted.current.setStyle({ weight: 2, fillOpacity: 0.65 });
    const marker = selectedId ? markerIndex.current.get(selectedId) : undefined;
    highlighted.current = marker ?? null;
    if (!marker || !map.current) return;
    marker.setStyle({ weight: 6, fillOpacity: 1 }).bringToFront();
    map.current.setView(marker.getLatLng(), Math.max(map.current.getZoom(), 5));
    marker.openPopup();
  }, [selectedId, earthquakes]);
  return <section aria-label="Earthquake map">
    <div ref={container} className="earthquake-map" style={{ height }} />
    <div className="map-resize-handle" role="separator" tabIndex={0}
      aria-label="Resize map height" aria-orientation="horizontal"
      aria-valuemin={240} aria-valuemax={1000} aria-valuenow={height} aria-valuetext={`${height} pixels`}
      onPointerDown={event => {
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, height };
      }}
      onPointerMove={event => { if (drag.current) resize(drag.current.height + event.clientY - drag.current.y); }}
      onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        resize(event.key === 'Home' ? 240 : event.key === 'End' ? 1000 : height + (event.key === 'ArrowDown' ? 40 : -40));
      }}
    ><span aria-hidden="true">━━</span><span>Drag to resize map</span></div>
    <p className="map-legend">Map shows all {earthquakes.length.toLocaleString()} matching earthquakes. Size: magnitude. Depth: <span>● shallow (&lt;70 km)</span> · <span>● intermediate (70–300 km)</span> · <span>● deep (≥300 km)</span>. Select a marker for details.</p>
  </section>;
}
