import type { Geofence } from "./types";

/**
 * Geofence check for claims. Pure functions (no Next imports) so they are unit-testable.
 * GPS can be spoofed, so this is a speed bump against remote proxy claims, not proof of presence.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number; // metres, as reported by the browser
}

const EARTH_RADIUS_M = 6_371_000;
export const MIN_RADIUS_M = 10;
export const MAX_RADIUS_M = 5_000;
/** Indoor GPS is often off by tens of metres, so we forgive up to this much reported accuracy. */
export const MAX_ACCURACY_ALLOWANCE_M = 100;

export function isLatLng(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Parses a {lat, lng, accuracy} object from untrusted JSON; null if missing or invalid. */
export function parseGeoPoint(value: unknown): GeoPoint | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isLatLng(v.lat, v.lng)) return null;
  const accuracy = typeof v.accuracy === "number" && Number.isFinite(v.accuracy) && v.accuracy >= 0 ? v.accuracy : undefined;
  return { lat: v.lat as number, lng: v.lng as number, accuracy };
}

/** Great-circle distance in metres (haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeofenceCheck =
  | { ok: true; distanceM: number | null }
  | { ok: false; reason: "no_location"; distanceM: null }
  | { ok: false; reason: "outside"; distanceM: number; allowedM: number };

/** Accepts when distance <= radius + min(accuracy, 100 m). Events without an enabled fence always pass. */
export function checkGeofence(fence: Geofence | null | undefined, point: GeoPoint | null): GeofenceCheck {
  if (!fence || !fence.enabled) return { ok: true, distanceM: point && fence ? Math.round(haversineMeters(fence, point)) : null };
  if (!point) return { ok: false, reason: "no_location", distanceM: null };
  const distanceM = Math.round(haversineMeters(fence, point));
  const allowedM = Math.round(fence.radiusM + Math.min(point.accuracy ?? 0, MAX_ACCURACY_ALLOWANCE_M));
  return distanceM <= allowedM ? { ok: true, distanceM } : { ok: false, reason: "outside", distanceM, allowedM };
}
