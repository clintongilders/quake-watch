import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface Earthquake {
  id: number; usgsId: string; magnitude: number; place: string;
  occurredAt: string; latitude: number; longitude: number; depth: number;
}

export default function EarthquakeMap({ earthquakes }: { earthquakes: Earthquake[] }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current).setView([20, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    map.current = instance;
    return () => { instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    const markers = L.featureGroup().addTo(map.current);
    for (const quake of earthquakes) {
      if (!Number.isFinite(quake.latitude) || !Number.isFinite(quake.longitude)) continue;
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `M ${quake.magnitude.toFixed(2)} — ${quake.place}`;
      const detail = document.createElement('p');
      detail.textContent = `${new Date(quake.occurredAt).toLocaleString()} · ${quake.depth.toFixed(2)} km deep`;
      const link = document.createElement('a');
      link.href = `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(quake.usgsId)}`;
      link.textContent = 'View on USGS'; link.target = '_blank'; link.rel = 'noopener noreferrer';
      popup.append(title, detail, link);
      L.circleMarker([quake.latitude, quake.longitude], {
        radius: Math.max(5, Math.min(22, quake.magnitude * 3)),
        color: quake.depth < 70 ? '#0f766e' : quake.depth < 300 ? '#b45309' : '#be123c',
        fillOpacity: 0.65, weight: 2,
      }).bindPopup(popup).bindTooltip(title.textContent).addTo(markers);
    }
    if (markers.getLayers().length) map.current.fitBounds(markers.getBounds(), { padding: [30, 30], maxZoom: 7 });
    return () => { markers.remove(); };
  }, [earthquakes]);
  return <section aria-label="Earthquake map">
    <div ref={container} className="earthquake-map" />
    <p className="map-legend">Map shows this page of results. Size: magnitude. Depth: <span>● shallow (&lt;70 km)</span> · <span>● intermediate (70–300 km)</span> · <span>● deep (≥300 km)</span>. Select a marker for details.</p>
  </section>;
}
