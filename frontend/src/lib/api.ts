import { z } from "zod";

export const earthquakeSchema = z.object({
  id: z.number().optional().default(0),
  usgsId: z.string(),
  magnitude: z.number().finite().nullable(),
  place: z.string(),
  occurredAt: z.string().datetime({ offset: true }),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  depth: z.number().finite().nullable(),
});
export type Earthquake = z.infer<typeof earthquakeSchema>;
export const collectionSchema = z.object({
  totalItems: z.number().int().nonnegative(),
  member: z.array(earthquakeSchema),
  view: z
    .object({ next: z.string().optional(), last: z.string().optional() })
    .optional(),
});
const geojsonSchema = z.object({
  type: z.literal("FeatureCollection"),
  totalItems: z.number().int().nonnegative(),
  truncated: z.boolean(),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      id: z.string(),
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([
          z.number().finite(),
          z.number().finite(),
          z.number().finite().nullable(),
        ]),
      }),
      properties: z.object({
        magnitude: z.number().finite().nullable(),
        place: z.string(),
        occurredAt: z.string().datetime({ offset: true }),
      }),
    }),
  ),
});

export function apiUrl(path: string) {
  const base = import.meta.env.VITE_API_URL || window.location.origin;
  return new URL(path, base.endsWith("/") ? base : base + "/");
}
async function json(url: URL, signal: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/ld+json, application/json" },
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<unknown>;
}
export async function fetchCollection(url: URL, signal: AbortSignal) {
  const value = await json(url, signal);
  const parsed = collectionSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("API returned an invalid earthquake collection.");
  return parsed.data;
}
export async function fetchMap(url: URL, signal: AbortSignal) {
  const value = await json(url, signal);
  const parsed = geojsonSchema.safeParse(value);
  if (!parsed.success) throw new Error("API returned invalid map results.");
  const data = parsed.data;
  const earthquakes = data.features.map((f) =>
    earthquakeSchema.parse({
      ...f.properties,
      usgsId: f.id,
      longitude: f.geometry.coordinates[0],
      latitude: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2],
    }),
  );
  return {
    earthquakes,
    totalItems: data.totalItems,
    truncated: data.truncated,
  };
}
export const magnitudeLabel = (magnitude: number | null) =>
  magnitude === null ? "Unknown" : magnitude.toFixed(2);
export const depthLabel = (depth: number | null) =>
  depth === null ? "Unknown depth" : `${depth.toFixed(2)} km`;
