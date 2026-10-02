import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import EarthquakeMap, { type Earthquake } from './EarthquakeMap';

const leaflet = vi.hoisted(() => {
  const map = { setView: vi.fn(), fitBounds: vi.fn(), getZoom: vi.fn(() => 2), invalidateSize: vi.fn(), remove: vi.fn() };
  map.setView.mockReturnValue(map);
  const markers: Array<{ setStyle: ReturnType<typeof vi.fn>; bringToFront: ReturnType<typeof vi.fn>; openPopup: ReturnType<typeof vi.fn>; getLatLng: ReturnType<typeof vi.fn>; bindPopup: ReturnType<typeof vi.fn>; bindTooltip: ReturnType<typeof vi.fn>; addTo: ReturnType<typeof vi.fn> }> = [];
  const group = { addTo: vi.fn(), getLayers: vi.fn(() => markers), getBounds: vi.fn(() => []), remove: vi.fn() };
  group.addTo.mockReturnValue(group);
  const tile = { addTo: vi.fn() };
  const circleMarker = vi.fn((coordinates: number[]) => {
    const marker = { setStyle: vi.fn(), bringToFront: vi.fn(), openPopup: vi.fn(), getLatLng: vi.fn(() => coordinates), bindPopup: vi.fn(), bindTooltip: vi.fn(), addTo: vi.fn() };
    for (const key of ['setStyle', 'bringToFront', 'bindPopup', 'bindTooltip', 'addTo'] as const) marker[key].mockReturnValue(marker);
    markers.push(marker); return marker;
  });
  return { map, group, markers, tile, circleMarker, createMap: vi.fn(() => map), tileLayer: vi.fn(() => tile) };
});
vi.mock('leaflet', () => ({ default: { map: leaflet.createMap, tileLayer: leaflet.tileLayer, featureGroup: () => leaflet.group, circleMarker: leaflet.circleMarker } }));
const quake: Earthquake = { id: 1, usgsId: 'test', magnitude: 4, place: '<script>unsafe</script>', latitude: 49, longitude: -123, depth: 10, occurredAt: '2026-09-02T12:00:00Z' };
let resizeCallback: () => void;
const disconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks(); leaflet.markers.length = 0;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallback = callback; }
    observe = vi.fn(); disconnect = disconnect;
  });
});

it('bounds the map, disables repeated tiles, and cleans up observers on unmount', () => {
  const { unmount } = render(<EarthquakeMap earthquakes={[quake]} selectedId={null} />);
  expect(leaflet.createMap).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ minZoom: 2, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 }));
  expect(leaflet.tileLayer).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ noWrap: true }));
  resizeCallback(); expect(leaflet.map.invalidateSize).toHaveBeenCalled();
  unmount(); expect(disconnect).toHaveBeenCalled(); expect(leaflet.map.remove).toHaveBeenCalled(); expect(leaflet.group.remove).toHaveBeenCalled();
});

it('highlights the selected quake, opens its popup, and clears the highlight', () => {
  const earthquakes = [quake];
  const { rerender } = render(<EarthquakeMap earthquakes={earthquakes} selectedId={null} />);
  rerender(<EarthquakeMap earthquakes={earthquakes} selectedId="test" />);
  const marker = leaflet.markers[0];
  expect(marker.setStyle).toHaveBeenCalledWith({ weight: 6, fillOpacity: 1 });
  expect(marker.openPopup).toHaveBeenCalled();
  expect(leaflet.map.setView).toHaveBeenLastCalledWith([49, -123], 5);
  rerender(<EarthquakeMap earthquakes={earthquakes} selectedId={null} />);
  expect(marker.setStyle).toHaveBeenLastCalledWith({ weight: 2, fillOpacity: 0.65 });
});

it('skips invalid coordinates and renders popup titles as text', () => {
  render(<EarthquakeMap earthquakes={[quake, { ...quake, usgsId: 'bad', latitude: NaN }]} selectedId={null} />);
  expect(leaflet.circleMarker).toHaveBeenCalledTimes(1);
  const popup = leaflet.markers[0].bindPopup.mock.calls[0][0]() as HTMLElement;
  expect(popup.querySelector('script')).toBeNull();
  expect(popup.textContent).toContain(quake.place);
  expect(popup.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer');
});

it('resizes by keyboard and respects minimum and maximum height', () => {
  render(<EarthquakeMap earthquakes={[]} selectedId={null} />);
  const handle = screen.getByRole('separator');
  expect(handle).toHaveAttribute('aria-valuenow', '420');
  fireEvent.keyDown(handle, { key: 'ArrowDown' }); expect(handle).toHaveAttribute('aria-valuenow', '460');
  fireEvent.keyDown(handle, { key: 'Home' });
  fireEvent.keyDown(handle, { key: 'ArrowUp' }); expect(handle).toHaveAttribute('aria-valuenow', '240');
  fireEvent.keyDown(handle, { key: 'End' });
  fireEvent.keyDown(handle, { key: 'ArrowDown' }); expect(handle).toHaveAttribute('aria-valuenow', '1000');
});

it('uses the compact initial height on mobile', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  render(<EarthquakeMap earthquakes={[]} selectedId={null} />);
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '320');
});

it('resizes by pointer and stops changing height after the drag ends', () => {
  // jsdom does not supply PointerEvent or pointer capture APIs.
  vi.stubGlobal('PointerEvent', MouseEvent);
  const { container } = render(<EarthquakeMap earthquakes={[]} selectedId={null} />);
  const handle = screen.getByRole('separator');
  handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { clientY: 100 });
  fireEvent.pointerMove(handle, { clientY: 200 });
  expect(handle).toHaveAttribute('aria-valuenow', '520');
  expect(container.querySelector('.earthquake-map')).toHaveStyle({ height: '520px' });
  fireEvent.pointerUp(handle);
  fireEvent.pointerMove(handle, { clientY: 300 });
  expect(handle).toHaveAttribute('aria-valuenow', '520');
});
