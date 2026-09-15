import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import L from "leaflet";
import { Trash2, X as XIcon } from "lucide-react";
import type { PhotoMemory } from "@/lib/photos";

type Props = {
  map: L.Map | null;
  photos: PhotoMemory[];
  onMove: (id: string, at: { lat: number; lng: number }) => void;
  onResize: (id: string, sizeM: number) => void;
  onDelete: (photo: PhotoMemory) => void;
  /** current map twist angle in degrees, so photos stay pinned to the ground */
  rotation?: number;
};

/** true once Leaflet's panes are positioned and projection maths is safe */
function mapReady(map: L.Map | null): map is L.Map {
  if (!map) return false;
  try {
    const pane = map.getPane("mapPane") as (HTMLElement & { _leaflet_pos?: unknown }) | undefined;
    return !!pane && pane["_leaflet_pos"] !== undefined;
  } catch {
    return false;
  }
}

/** screen pixels per metre at the map's current zoom */
function pxPerMetre(map: L.Map) {
  const a = map.containerPointToLatLng(L.point(0, 0));
  const b = map.containerPointToLatLng(L.point(100, 0));
  const d = map.distance(a, b);
  return d > 0 ? 100 / d : 1;
}

type Drag = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origPx: number;
  moved: boolean;
};

export default function PhotoMemories({
  map,
  photos,
  onMove,
  onResize,
  onDelete,
  rotation = 0,
}: Props) {
  const [viewVersion, bump] = useReducer((n: number) => n + 1, 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [live, setLive] = useState<{ id: string; x: number; y: number; px: number } | null>(null);
  const drag = useRef<Drag | null>(null);

  // Reposition only when the view settles; while panning/zooming the whole
  // layer is CSS-transformed instead of re-rendering every frame.
  const layerRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ tl: L.LatLng; zoom: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    const onChange = () => bump();
    map.whenReady(onChange);
    map.on("moveend zoomend resize", onChange);
    return () => {
      map.off("moveend zoomend resize", onChange);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      const el = layerRef.current;
      const a = anchor.current;
      if (!el || !a) return;
      const scale = map.getZoomScale(map.getZoom(), a.zoom);
      const p = map.latLngToContainerPoint(a.tl);
      el.style.transformOrigin = "0 0";
      el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${scale})`;
    };
    const onMove = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };
    map.on("move zoom", onMove);
    return () => {
      map.off("move zoom", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map]);

  // Re-anchor only after the map view settles, not after photo selection/drag renders.
  useEffect(() => {
    if (!mapReady(map)) return;
    anchor.current = { tl: map.containerPointToLatLng(L.point(0, 0)), zoom: map.getZoom() };
    if (layerRef.current) layerRef.current.style.transform = "translate3d(0,0,0)";
  }, [map, viewVersion]);

  // deselect when tapping empty map space
  useEffect(() => {
    if (!map) return;
    const clear = () => setSelectedId(null);
    map.on("click", clear);
    return () => {
      map.off("click", clear);
    };
  }, [map]);

  const start = useCallback(
    (
      e: React.PointerEvent,
      photo: PhotoMemory,
      mode: "move" | "resize",
      x: number,
      y: number,
      px: number,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      map?.dragging.disable();
      drag.current = {
        id: photo.id,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origX: x,
        origY: y,
        origPx: px,
        moved: false,
      };
      setLive({ id: photo.id, x, y, px });
    },
    [map],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      // undo the map twist so a photo follows the finger while the map is rotated
      const rad = (-rotation * Math.PI) / 180;
      const rawX = e.clientX - d.startX;
      const rawY = e.clientY - d.startY;
      const dx = rawX * Math.cos(rad) - rawY * Math.sin(rad);
      const dy = rawX * Math.sin(rad) + rawY * Math.cos(rad);
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
      if (d.mode === "move") {
        setLive({ id: d.id, x: d.origX + dx, y: d.origY + dy, px: d.origPx });
      } else {
        const next = Math.max(18, d.origPx + (dx + dy) / 2);
        setLive({ id: d.id, x: d.origX, y: d.origY, px: next });
      }
    },
    [rotation],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      map?.dragging.enable();
      if (!d || !mapReady(map)) {
        setLive(null);
        return;
      }
      const photo = photos.find((p) => p.id === d.id);
      const l = live;
      setLive(null);
      if (!photo || !l) return;
      if (!d.moved) {
        // simple tap: select, or open if already selected
        if (selectedId === photo.id) setOpenId(photo.id);
        else setSelectedId(photo.id);
        return;
      }
      if (d.mode === "move") {
        const ll = map.containerPointToLatLng(L.point(l.x, l.y));
        onMove(photo.id, { lat: ll.lat, lng: ll.lng });
      } else {
        onResize(photo.id, Math.max(2, l.px / pxPerMetre(map)));
      }
      e.stopPropagation();
    },
    [live, map, onMove, onResize, photos, selectedId],
  );

  if (!mapReady(map)) return null;
  const scale = pxPerMetre(map);
  const open = photos.find((p) => p.id === openId) ?? null;
  const size = map.getSize();
  const viewMargin = 160;

  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-[500]"
        style={{ transform: `rotate(${rotation}deg)`, transformOrigin: "50% 50%" }}
      >
        <div
          ref={layerRef}
          className="pointer-events-none absolute inset-0 z-[500] will-change-transform"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ pointerEvents: drag.current ? "auto" : "none" }}
        >
          {photos.map((photo) => {
            const l = live && live.id === photo.id ? live : null;
            const base = map.latLngToContainerPoint(L.latLng(photo.lat, photo.lng));
            const x = l ? l.x : base.x;
            const y = l ? l.y : base.y;
            const px = l ? l.px : Math.max(10, photo.sizeM * scale);
            if (
              !l &&
              (x < -viewMargin ||
                y < -viewMargin ||
                x > size.x + viewMargin ||
                y > size.y + viewMargin)
            ) {
              return null;
            }
            const selected = selectedId === photo.id;
            const pin = Math.min(10, Math.max(3, px * 0.16));
            return (
              <div
                key={photo.id}
                data-photo
                className="pointer-events-auto absolute"
                style={{
                  left: x,
                  top: y,
                  width: px,
                  height: px,
                  transform: "translate(-50%, -50%)",
                  touchAction: "none",
                }}
                onPointerDown={(e) => start(e, photo, "move", base.x, base.y, px)}
              >
                <div
                  className="h-full w-full overflow-hidden bg-background"
                  style={{
                    border: `${Math.max(1, px * 0.03)}px solid oklch(0.55 0.2 27)`,
                    boxShadow: selected
                      ? "0 0 0 2px oklch(0.75 0.15 80), 0 2px 6px rgba(0,0,0,.45)"
                      : "0 2px 6px rgba(0,0,0,.45)",
                  }}
                >
                  <img
                    src={photo.url}
                    alt="Pinned photo memory"
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                </div>
                {/* pin */}
                <div
                  className="absolute rounded-full"
                  style={{
                    width: pin,
                    height: pin,
                    left: "50%",
                    top: -pin / 2,
                    transform: "translateX(-50%)",
                    background: "oklch(0.55 0.2 27)",
                    boxShadow: "0 1px 2px rgba(0,0,0,.6)",
                  }}
                />
                {selected && (
                  <div
                    className="absolute flex items-center justify-center rounded-full border border-white/50 bg-black/80"
                    style={{
                      width: 22,
                      height: 22,
                      right: -11,
                      bottom: -11,
                      cursor: "nwse-resize",
                      touchAction: "none",
                      boxShadow: "0 1px 3px rgba(0,0,0,.6)",
                    }}
                    onPointerDown={(e) => start(e, photo, "resize", base.x, base.y, px)}
                  >
                    <div className="rounded-full bg-white" style={{ width: 8, height: 8 }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {open && (
        <div
          className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setOpenId(null)}
        >
          <div className="relative max-h-full w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <img
              src={open.url}
              alt="Photo memory"
              className="aspect-square w-full object-cover"
              style={{ border: "4px solid oklch(0.55 0.2 27)" }}
            />
            <div className="mt-3 flex justify-between">
              <button
                type="button"
                className="flex items-center gap-2 border border-border px-3 py-2 text-sm text-foreground"
                onClick={() => setOpenId(null)}
              >
                <XIcon className="h-4 w-4" /> Close
              </button>
              <button
                type="button"
                className="flex items-center gap-2 border border-destructive px-3 py-2 text-sm text-destructive"
                onClick={() => {
                  onDelete(open);
                  setOpenId(null);
                  setSelectedId(null);
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
