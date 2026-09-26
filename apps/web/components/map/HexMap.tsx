"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, {
  Layer,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import { setWorkerUrl } from "maplibre-gl";
import { circlePolygon, formatCents, formatSurge, type CellPrice } from "@groundtruth/shared";
import { MAPLIBRE_WORKER_PATH } from "@/lib/client/maplibreWorker";
import { coverageFeatures } from "@/lib/client/coverage";
import { cn } from "@/lib/client/cn";

/** Dark basemap (same glyphs and sprite as positron), matching the mission-control UI. */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

// maplibre-gl v6 starts an ES-module worker that imports `./maplibre-gl-shared.mjs` relative to
// itself. Turbopack's hashed chunks break that lookup ("Worker failed to load"), so both files are
// served as-is from public/ (copies checked against node_modules by lib/client/maplibreWorker.test.ts).
if (typeof window !== "undefined") {
  setWorkerUrl(new URL(MAPLIBRE_WORKER_PATH, window.location.origin).href);
}
const HATCH = "gt-hatch";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  status: string;
  label?: string;
}

export interface HexMapProps {
  center: { lat: number; lng: number };
  zoom?: number;
  cells?: CellPrice[];
  points?: MapPoint[];
  circle?: { lat: number; lng: number; radiusM: number } | null;
  marker?: { lat: number; lng: number } | null;
  /** Map click anywhere (not only on cells). */
  onMapClick?: (lat: number, lng: number) => void;
  onPointClick?: (id: string) => void;
  /** Re-center when this changes. */
  flyKey?: string;
  className?: string;
  cursor?: string;
}

const POINT_COLORS: Record<string, string> = {
  accepted: "#3DDC84",
  needs_review: "#FFB020",
  rejected: "#FF5A52",
  verifying: "#D6E4FF",
  pending: "#8A8F98",
};

const fillLayer: LayerProps = {
  id: "cells-fill",
  type: "fill",
  paint: {
    "fill-color": ["get", "color"],
    "fill-opacity": ["case", ["get", "paused"], 0.3, 0.38],
  },
};
const hatchLayer: LayerProps = {
  id: "cells-hatch",
  type: "fill",
  filter: ["==", ["get", "paused"], true],
  paint: { "fill-pattern": HATCH },
};
const lineLayer: LayerProps = {
  id: "cells-line",
  type: "line",
  paint: { "line-color": "#ffffff", "line-width": 1, "line-opacity": 0.35 },
};
const pausedLineLayer: LayerProps = {
  id: "cells-paused-line",
  type: "line",
  filter: ["==", ["get", "paused"], true],
  paint: { "line-color": "#8A8F98", "line-width": 1.5, "line-dasharray": [2, 2] },
};
const labelLayer: LayerProps = {
  id: "cells-label",
  type: "symbol",
  minzoom: 13.2,
  layout: {
    "text-field": ["get", "price_label"],
    "text-font": ["Noto Sans Regular"],
    "text-size": 11,
    "text-allow-overlap": false,
  },
  paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.4 },
};
const pointLayer: LayerProps = {
  id: "points",
  type: "circle",
  paint: {
    "circle-radius": 6,
    "circle-color": ["coalesce", ["get", "color"], "#8A8F98"],
    "circle-stroke-color": "#000000",
    "circle-stroke-width": 2,
  },
};
const circleLayer: LayerProps = {
  id: "area-outline",
  type: "line",
  paint: { "line-color": "#D6E4FF", "line-width": 1.5, "line-dasharray": [3, 2] },
};

/** 16×16 diagonal hatch as raw RGBA for map.addImage. */
function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (x + y) % 8 < 2;
      const i = (y * size + x) * 4;
      data[i] = 138;
      data[i + 1] = 143;
      data[i + 2] = 152;
      data[i + 3] = on ? 170 : 0;
    }
  }
  return { width: size, height: size, data };
}

interface CellPopup {
  lng: number;
  lat: number;
  cell: CellPrice;
}

export default function HexMap({
  center,
  zoom = 13.5,
  cells = [],
  points = [],
  circle,
  marker,
  onMapClick,
  onPointClick,
  flyKey,
  className,
  cursor,
}: HexMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  /** The basemap style never loaded (tile server down, offline, blocked): show a static notice. */
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const readyRef = useRef(false);
  readyRef.current = ready;
  // Errors after the style loaded are individual tiles (MapLibre retries them): ignore those.
  const onError = useCallback(() => {
    if (!readyRef.current) setFailed(true);
  }, []);
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => {
      if (!readyRef.current) setFailed(true);
    }, 20_000);
    return () => clearTimeout(t);
  }, [ready, attempt]);
  const [popup, setPopup] = useState<CellPopup | null>(null);

  const cellFc = useMemo(() => coverageFeatures(cells), [cells]);
  const byCell = useMemo(() => new Map(cells.map((c) => [c.cell, c])), [cells]);
  const pointFc = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: points.map((p) => ({
        type: "Feature" as const,
        id: p.id,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { id: p.id, status: p.status, color: POINT_COLORS[p.status] ?? "#8A8F98" },
      })),
    }),
    [points],
  );
  const circleFc = useMemo(() => (circle ? circlePolygon(circle.lat, circle.lng, circle.radiusM) : null), [circle]);

  useEffect(() => {
    if (!flyKey || !ready) return;
    mapRef.current?.flyTo({ center: [center.lng, center.lat], zoom, duration: 800 });
    // center/zoom are intentionally read at flyKey change only.
  }, [flyKey, ready]);

  // Layers go on as soon as the style is parsed, not on "load" (which waits for every basemap
  // tile): on slow venue Wi-Fi the hexes must not wait for the basemap.
  const onStyleData = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (!map.hasImage(HATCH)) map.addImage(HATCH, hatchImage());
    setReady(true);
  }, []);

  const onClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (f?.layer.id === "points" && onPointClick) {
        onPointClick(String(f.properties?.id));
        return;
      }
      if (f?.layer.id === "cells-fill" && !onMapClick) {
        const c = byCell.get(String(f.properties?.cell));
        if (c) setPopup({ lng: e.lngLat.lng, lat: e.lngLat.lat, cell: c });
        return;
      }
      setPopup(null);
      onMapClick?.(e.lngLat.lat, e.lngLat.lng);
    },
    [byCell, onMapClick, onPointClick],
  );

  return (
    <div className={cn("relative h-full w-full", className)}>
      {failed ? (
        <MapUnavailable
          onRetry={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        />
      ) : null}
      <MapGL
        key={attempt}
        ref={mapRef}
        onError={onError}
        initialViewState={{ latitude: center.lat, longitude: center.lng, zoom }}
        mapStyle={MAP_STYLE}
        style={{ width: "100%", height: "100%" }}
        onStyleData={onStyleData}
        onClick={onClick}
        interactiveLayerIds={ready ? ["cells-fill", ...(points.length ? ["points"] : [])] : []}
        cursor={cursor}
        attributionControl={{ compact: true }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {ready ? (
          <>
            <Source id="cells" type="geojson" data={cellFc}>
              <Layer {...fillLayer} />
              <Layer {...hatchLayer} />
              <Layer {...lineLayer} />
              <Layer {...pausedLineLayer} />
              <Layer {...labelLayer} />
            </Source>
            {circleFc ? (
              <Source id="area" type="geojson" data={circleFc}>
                <Layer {...circleLayer} />
              </Source>
            ) : null}
            <Source id="points" type="geojson" data={pointFc}>
              <Layer {...pointLayer} />
            </Source>
          </>
        ) : null}
        {marker ? <Marker latitude={marker.lat} longitude={marker.lng} color="#D6E4FF" /> : null}
        {popup ? (
          <Popup longitude={popup.lng} latitude={popup.lat} onClose={() => setPopup(null)} closeOnClick={false}>
            <CellPopupBody cell={popup.cell} />
          </Popup>
        ) : null}
      </MapGL>
    </div>
  );
}

/** Static fallback when the basemap can't load. The page's lists and stats don't depend on it. */
export function MapUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm" role="status">
      <div className="max-w-xs border-l-2 border-warning py-1 pl-4 text-sm">
        <div className="caps text-xs font-semibold">Map unavailable</div>
        <p className="mt-1 text-muted-foreground">The map tiles couldn&apos;t load. Everything else on this page still works.</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="caps mt-3 cursor-pointer text-[11px] font-semibold text-primary hover:text-foreground">
            Try again →
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CellPopupBody({ cell }: { cell: CellPrice }) {
  return (
    <div className="min-w-40 space-y-1">
      <div className="font-mono text-[10px] text-muted-foreground">{cell.cell}</div>
      {cell.paused ? (
        <div className="font-semibold text-warning">Paused — {cell.paused_reason ?? "hazard warning"}</div>
      ) : (
        <div className="numeral text-xl text-primary">
          {formatCents(cell.price_cents)} <span className="text-sm text-muted-foreground">{formatSurge(cell.surge)}</span>
        </div>
      )}
      <div className="tabular-nums text-muted-foreground">
        {cell.accepted} / {cell.target} accepted
      </div>
    </div>
  );
}
