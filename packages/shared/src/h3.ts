/** H3 helpers (resolution 9 by default), PRD §10 / §14. */
import { cellToBoundary, cellToLatLng, latLngToCell, polygonToCells, gridDisk } from "h3-js";

export const H3_RES = 9;

export type LngLat = [number, number];

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: LngLat[][];
}

export interface CellFeature<P = Record<string, unknown>> {
  type: "Feature";
  id: string;
  geometry: GeoJSONPolygon;
  properties: P & { cell: string };
}

export interface CellFeatureCollection<P = Record<string, unknown>> {
  type: "FeatureCollection";
  features: CellFeature<P>[];
}

const EARTH_R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Polygon ring approximating a circle, GeoJSON order [lng, lat], closed. */
export function circlePolygon(lat: number, lng: number, radiusM: number, steps = 48): GeoJSONPolygon {
  const ring: LngLat[] = [];
  const latR = radiusM / 111_320;
  const lngR = radiusM / (111_320 * Math.cos(rad(lat)));
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    ring.push([lng + lngR * Math.cos(t), lat + latR * Math.sin(t)]);
  }
  ring.push(ring[0] as LngLat);
  return { type: "Polygon", coordinates: [ring] };
}

export function cellsForPolygon(polygon: GeoJSONPolygon, res = H3_RES): string[] {
  const cells = polygonToCells(polygon.coordinates, res, true);
  return cells.sort();
}

/**
 * Cells covering a circle. Includes any cell whose center is inside the circle, and always the
 * center cell, so tiny radii still produce one cell.
 */
export function cellsForCircle(lat: number, lng: number, radiusM: number, res = H3_RES): string[] {
  const center = latLngToCell(lat, lng, res);
  const k = Math.max(1, Math.ceil(radiusM / 150) + 1);
  const out = gridDisk(center, k).filter((c) => {
    const [clat, clng] = cellToLatLng(c);
    return haversineM(lat, lng, clat, clng) <= radiusM;
  });
  if (!out.includes(center)) out.push(center);
  return out.sort();
}

export function cellForPoint(lat: number, lng: number, res = H3_RES): string {
  return latLngToCell(lat, lng, res);
}

export function cellCenter(cell: string): { lat: number; lng: number } {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

export function cellToPolygon(cell: string): GeoJSONPolygon {
  const ring = cellToBoundary(cell, true) as LngLat[];
  return { type: "Polygon", coordinates: [ring] };
}

export function cellsToFeatureCollection<P extends Record<string, unknown>>(
  cells: string[],
  props: (cell: string) => P = () => ({}) as P,
): CellFeatureCollection<P> {
  return {
    type: "FeatureCollection",
    features: cells.map((cell) => ({
      type: "Feature",
      id: cell,
      geometry: cellToPolygon(cell),
      properties: { ...props(cell), cell },
    })),
  };
}

/** Ray-casting point-in-polygon on the outer ring (GeoJSON [lng, lat]). */
export function pointInPolygon(lat: number, lng: number, polygon: GeoJSONPolygon): boolean {
  const ring = polygon.coordinates[0] ?? [];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as LngLat;
    const [xj, yj] = ring[j] as LngLat;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside a bounty area = point's cell is one of the bounty cells OR point is inside the geometry. */
export function insideBountyArea(
  lat: number,
  lng: number,
  cells: string[],
  area: GeoJSONPolygon | null,
  res = H3_RES,
): boolean {
  if (cells.includes(latLngToCell(lat, lng, res))) return true;
  return area ? pointInPolygon(lat, lng, area) : false;
}
