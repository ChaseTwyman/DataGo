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

export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

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
  accepted: "#047857",
  needs_review: "#b45309",
  rejected: "#b91c1c",
  verifying: "#4338ca",
  pending: "#6b7280",
};

const fillLayer: LayerProps = {
  id: "cells-fill",
  type: "fill",
  paint: {
    "fill-color": ["get", "color"],
    "fill-opacity": ["case", ["get", "paused"], 0.35, 0.45],
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
  paint: { "line-color": "#ffffff", "line-width": 1.2, "line-opacity": 0.9 },
};
const pausedLineLayer: LayerProps = {
  id: "cells-paused-line",
  type: "line",
  filter: ["==", ["get", "paused"], true],
  paint: { "line-color": "#374151", "line-width": 1.5, "line-dasharray": [2, 2] },
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
  paint: { "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
};
const pointLayer: LayerProps = {
  id: "points",
  type: "circle",
  paint: {
    "circle-radius": 6,
    "circle-color": ["coalesce", ["get", "color"], "#6b7280"],
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 2,
  },
};
const circleLayer: LayerProps = {
  id: "area-outline",
  type: "line",
  paint: { "line-color": "#1d4ed8", "line-width": 2, "line-dasharray": [3, 2] },
};

/** 16×16 diagonal hatch as raw RGBA for map.addImage. */
function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (x + y) % 8 < 2;
      const i = (y * size + x) * 4;
      data[i] = 55;
      data[i + 1] = 65;
      data[i + 2] = 81;
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
        properties: { id: p.id, status: p.status, color: POINT_COLORS[p.status] ?? "#6b7280" },
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
      <MapGL
        ref={mapRef}
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
        {marker ? <Marker latitude={marker.lat} longitude={marker.lng} color="#1d4ed8" /> : null}
        {popup ? (
          <Popup longitude={popup.lng} latitude={popup.lat} onClose={() => setPopup(null)} closeOnClick={false}>
            <CellPopupBody cell={popup.cell} />
          </Popup>
        ) : null}
      </MapGL>
    </div>
  );
}

function CellPopupBody({ cell }: { cell: CellPrice }) {
  return (
    <div className="min-w-40 space-y-0.5">
      <div className="font-mono text-[10px] text-gray-500">{cell.cell}</div>
      {cell.paused ? (
        <div className="font-semibold text-gray-800">Paused — {cell.paused_reason ?? "hazard warning"}</div>
      ) : (
        <div className="font-semibold">
          {formatCents(cell.price_cents)} <span className="font-normal text-gray-500">{formatSurge(cell.surge)}</span>
        </div>
      )}
      <div>
        {cell.accepted} / {cell.target} accepted
      </div>
    </div>
  );
}
