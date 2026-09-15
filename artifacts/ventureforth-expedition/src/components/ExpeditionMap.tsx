import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { LatLng } from "@/lib/expedition";
import { ARRIVAL_RADIUS, REVEAL_RADIUS, destinationFrom, distanceMeters } from "@/lib/expedition";

type Props = {
  player: LatLng;
  heading: number | null;
  destination: LatLng | null;
  /** destination is only drawn once the player has uncovered that patch of map */
  destinationVisible: boolean;
  /** everywhere the player has physically been this expedition */
  trail: LatLng[];
  arrived: boolean;
  follow: boolean;
  onUserPan: () => void;
  onMapReady: (map: L.Map) => void;
  /** Other room members, carried by Realtime rather than the fog/trail system. */
  otherPlayers?: Array<{ id: string; name: string; location: LatLng | null; connected: boolean }>;
  /** two-finger twist angle in degrees, reported back so overlays can match */
  onRotate?: (deg: number) => void;
};

const MAX_TRAIL_GAP = 500;

function playerIcon() {
  return L.divIcon({
    className: "",
    iconSize: [56, 56],
    iconAnchor: [28, 28],
    html: `
      <div style="position:relative;width:56px;height:56px;display:grid;place-items:center;">
        <div class="player-aura" style="position:absolute;width:120px;height:120px;border-radius:50%;opacity:0;"></div>
        <div class="player-arrow" style="position:absolute;inset:0;transition:transform .1s linear;opacity:0;">
          <div style="position:absolute;left:50%;top:-1px;translate:-50% 0;width:0;height:0;
            border-left:8px solid transparent;border-right:8px solid transparent;
            border-bottom:14px solid oklch(0.86 0.15 78);
            filter:drop-shadow(0 0 6px oklch(0.8 0.15 78 / .7));"></div>
        </div>
        <div style="position:absolute;width:44px;height:44px;border-radius:50%;
          border:1px solid oklch(0.86 0.15 78 / .35);"></div>
        <div style="width:18px;height:18px;border-radius:50%;background:oklch(0.96 0.02 90);
          border:3px solid oklch(0.8 0.15 78);
          box-shadow:0 0 0 5px oklch(0.8 0.15 78 / .16),0 0 18px oklch(0.8 0.15 78 / .55);"></div>
      </div>`,
  });
}

function escapeHtml(value: string) {
  const escapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (char) => escapes[char] ?? char);
}

function remotePlayerIcon(name: string) {
  return L.divIcon({
    className: "hunt-remote-marker",
    iconSize: [42, 52],
    iconAnchor: [21, 26],
    html: `<div style="display:grid;justify-items:center;gap:3px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.45));">
      <div style="width:18px;height:18px;border-radius:50%;background:oklch(0.7 0.17 215);border:3px solid oklch(0.96 0.02 90);box-shadow:0 0 0 5px oklch(0.7 0.17 215 / .2),0 0 13px oklch(0.7 0.17 215 / .65);"></div>
      <span style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid oklch(0.7 0.17 215 / .42);border-radius:999px;background:oklch(0.16 0.02 235 / .94);padding:2px 6px;color:oklch(0.92 0.03 215);font:600 9px system-ui;letter-spacing:.08em;">${escapeHtml(name)}</span>
    </div>`,
  });
}

const destIcon = L.divIcon({
  className: "",
  iconSize: [64, 64],
  iconAnchor: [32, 32],
  html: `
    <div style="width:64px;height:64px;display:grid;place-items:center;">
      <svg width="58" height="58" viewBox="0 0 60 60">
        <g stroke="oklch(0.7 0.2 35)" stroke-width="6" stroke-linecap="round"
           style="filter:drop-shadow(0 0 7px oklch(0.65 0.2 35 / .8));">
          <path d="M14 12 Q31 30 46 48" fill="none"/>
          <path d="M47 13 Q29 31 13 46" fill="none"/>
        </g>
      </svg>
    </div>`,
});

/** metres → screen pixels at the map's current centre/zoom */
function metresToPixels(map: L.Map, metres: number) {
  const c = map.getCenter();
  const a = map.latLngToContainerPoint(c);
  const east = destinationFrom({ lat: c.lat, lng: c.lng }, 90, metres);
  const b = map.latLngToContainerPoint(L.latLng(east.lat, east.lng));
  return Math.max(1, Math.abs(b.x - a.x));
}

export default function ExpeditionMap({
  player,
  heading,
  destination,
  destinationVisible,
  trail,
  arrived,
  follow,
  onUserPan,
  onMapReady,
  otherPlayers = [],
  onRotate,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const rotateRef = useRef<HTMLDivElement>(null);
  const bearing = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const fogRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const playerRef = useRef<L.Marker | null>(null);
  const destRef = useRef<L.Marker | null>(null);
  const ringRef = useRef<L.Circle | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const remoteRefs = useRef(new Map<string, L.Marker>());

  const programmatic = useRef(false);
  const drawn = useRef<{ tl: L.LatLng; zoom: number } | null>(null);
  const stampRef = useRef<{ radius: number; canvas: HTMLCanvasElement } | null>(null);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [player.lat, player.lng],
      zoom: 15,
      zoomControl: false,
      attributionControl: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    playerRef.current = L.marker([player.lat, player.lng], {
      icon: playerIcon(),
      zIndexOffset: 1000,
    }).addTo(map);

    const redraw = () => setTick((t) => t + 1);
    // Cheap: while panning/zooming we only translate the fog canvas (see below).
    map.on("moveend zoomend viewreset resize", redraw);

    map.on("dragstart", () => {
      if (!programmatic.current) onUserPan();
    });

    mapRef.current = map;
    onMapReady(map);
    setReady(true);
    setTimeout(() => map.invalidateSize(), 60);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // player position + destination overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ll = L.latLng(player.lat, player.lng);
    playerRef.current?.setLatLng(ll);

    if (destination && destinationVisible) {
      const dll = L.latLng(destination.lat, destination.lng);
      if (!destRef.current) {
        destRef.current = L.marker(dll, { icon: destIcon, interactive: false }).addTo(map);
        ringRef.current = L.circle(dll, {
          radius: ARRIVAL_RADIUS,
          color: "oklch(0.72 0.2 35)",
          weight: 1,
          fillColor: "oklch(0.72 0.2 35)",
          fillOpacity: 0.1,
        }).addTo(map);
        lineRef.current = L.polyline([ll, dll], {
          color: "oklch(0.8 0.15 78)",
          weight: 1.5,
          dashArray: "2 9",
          opacity: 0.55,
        }).addTo(map);
      }
      destRef.current.setLatLng(dll);
      ringRef.current?.setLatLng(dll);
      lineRef.current?.setLatLngs([ll, dll]);
    } else {
      destRef.current?.remove();
      ringRef.current?.remove();
      lineRef.current?.remove();
      destRef.current = null;
      ringRef.current = null;
      lineRef.current = null;
    }

    if (follow && !map.getBounds().pad(-0.3).contains(ll)) {
      programmatic.current = true;
      map.panTo(ll, { animate: false });
      programmatic.current = false;
    }
  }, [player, destination, destinationVisible, follow, ready]);

  // Other players are a separate Leaflet overlay. The fog canvas continues to
  // use only this player's trail, so remote movement cannot reveal terrain.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const currentIds = new Set(otherPlayers.map((peer) => peer.id));

    otherPlayers.forEach((peer) => {
      if (!peer.location) return;
      const point = L.latLng(peer.location.lat, peer.location.lng);
      let marker = remoteRefs.current.get(peer.id);
      if (!marker) {
        marker = L.marker(point, {
          icon: remotePlayerIcon(peer.name),
          interactive: false,
          zIndexOffset: 800,
        }).addTo(map);
        remoteRefs.current.set(peer.id, marker);
      }
      marker.setLatLng(point);
      marker.setOpacity(peer.connected ? 1 : 0.38);
      const element = marker.getElement();
      if (element) element.style.transition = "transform 1.2s linear, opacity .25s ease";
    });

    remoteRefs.current.forEach((marker, id) => {
      if (currentIds.has(id)) return;
      marker.remove();
      remoteRefs.current.delete(id);
    });
  }, [otherPlayers, ready]);

  // heading arrow + arrival aura
  useEffect(() => {
    const root = playerRef.current?.getElement();
    const el = root?.querySelector<HTMLElement>(".player-arrow");
    if (el) {
      if (heading === null) el.style.opacity = "0";
      else {
        el.style.opacity = "1";
        el.style.transform = `rotate(${heading}deg)`;
      }
    }
    const aura = root?.querySelector<HTMLElement>(".player-aura");
    if (aura) aura.classList.toggle("is-on", arrived);
  }, [heading, player, arrived, ready]);

  // ── fog of war ─────────────────────────────────────────────
  // Redrawn only when the view settles or the data changes; while the user
  // drags/zooms the canvas is just CSS-transformed, which stays at 60fps.
  useEffect(() => {
    const map = mapRef.current;
    const cv = fogRef.current;
    if (!map || !cv) return;
    const size = map.getSize();
    // Draw fog on a canvas larger than the screen so panning/zooming never
    // drags an uncovered edge into view before the next redraw.
    const padX = Math.round(size.x * 0.75);
    const padY = Math.round(size.y * 0.75);
    const w = size.x + padX * 2;
    const h = size.y + padY * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    // anchor for the cheap pan/zoom transform
    drawn.current = {
      tl: map.containerPointToLatLng(L.point(-padX, -padY)),
      zoom: map.getZoom(),
    };
    cv.style.transformOrigin = "0 0";
    cv.style.transform = `translate3d(${-padX}px, ${-padY}px, 0)`;

    // canvas pixel space is offset by the padding from container coords
    ctx.setTransform(dpr, 0, 0, dpr, padX * dpr, padY * dpr);
    ctx.clearRect(-padX, -padY, w, h);
    ctx.fillStyle = "rgba(8, 12, 20, 0.965)";
    ctx.fillRect(-padX, -padY, w, h);

    const r = metresToPixels(map, REVEAL_RADIUS);
    const margin = r * 2;
    const projected = trail.map((geo) => ({
      geo,
      point: map.latLngToContainerPoint(L.latLng(geo.lat, geo.lng)),
    }));
    // keep only segments that can touch the padded canvas area
    const visible = (p: L.Point) =>
      p.x > -padX - margin &&
      p.y > -padY - margin &&
      p.x < size.x + padX + margin &&
      p.y < size.y + padY + margin;
    const nearView = projected.filter(({ point }, i) => {
      const before = projected[i - 1]?.point;
      const after = projected[i + 1]?.point;
      return (
        visible(point) || (before ? visible(before) : false) || (after ? visible(after) : false)
      );
    });
    const pts = nearView.filter(({ point }, i) => {
      const previous = nearView[i - 1]?.point;
      return (
        !previous ||
        point.distanceTo(previous) >= Math.max(4, r * 0.18) ||
        i === nearView.length - 1
      );
    });
    if (!pts.length) return;

    ctx.globalCompositeOperation = "destination-out";
    const stampRadius = Math.max(2, Math.round(r * 1.15));
    if (!stampRef.current || stampRef.current.radius !== stampRadius) {
      const stamp = document.createElement("canvas");
      stamp.width = stampRadius * 2;
      stamp.height = stampRadius * 2;
      const stampCtx = stamp.getContext("2d");
      if (!stampCtx) return;
      const g = stampCtx.createRadialGradient(
        stampRadius,
        stampRadius,
        0,
        stampRadius,
        stampRadius,
        stampRadius,
      );
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.55, "rgba(0,0,0,1)");
      g.addColorStop(0.75, "rgba(0,0,0,0.55)");
      g.addColorStop(0.92, "rgba(0,0,0,0.18)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      stampCtx.fillStyle = g;
      stampCtx.fillRect(0, 0, stamp.width, stamp.height);
      stampRef.current = { radius: stampRadius, canvas: stamp };
    }
    const stamp = stampRef.current.canvas;
    const drawStamp = (p: L.Point) => ctx.drawImage(stamp, p.x - stampRadius, p.y - stampRadius);
    for (let i = 0; i < pts.length; i++) {
      const current = pts[i];
      if (!current) continue;
      const previous = pts[i - 1];
      if (previous && distanceMeters(previous.geo, current.geo) <= MAX_TRAIL_GAP) {
        const screenGap = current.point.distanceTo(previous.point);
        const steps = Math.min(24, Math.floor(screenGap / Math.max(4, r * 0.45)));
        for (let step = 1; step < steps; step++) {
          const ratio = step / steps;
          drawStamp(
            L.point(
              previous.point.x + (current.point.x - previous.point.x) * ratio,
              previous.point.y + (current.point.y - previous.point.y) * ratio,
            ),
          );
        }
      }
      drawStamp(current.point);
    }
    ctx.globalCompositeOperation = "source-over";
  }, [trail, tick, ready]);

  // cheap fog follow while panning / zooming
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      const cv = fogRef.current;
      const d = drawn.current;
      if (!cv || !d) return;
      const scale = map.getZoomScale(map.getZoom(), d.zoom);
      const p = map.latLngToContainerPoint(d.tl);
      cv.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${scale})`;
    };
    const onMove = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };
    map.on("move zoom", onMove);
    return () => {
      map.off("move zoom", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ready]);

  // two-finger twist to rotate the map, Google-Maps style
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    let startAngle: number | null = null;
    let startBearing = 0;
    let raf = 0;
    let pending = 0;

    const angleOf = (t: TouchList) => {
      const a = t[0]!;
      const b = t[1]!;
      return (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
    };
    const apply = () => {
      raf = 0;
      bearing.current = pending;
      if (rotateRef.current) rotateRef.current.style.transform = `rotate(${pending}deg)`;
      onRotate?.(pending);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startAngle = angleOf(e.touches);
      startBearing = bearing.current;
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startAngle === null) return;
      let next = startBearing + (angleOf(e.touches) - startAngle);
      next = ((next % 360) + 360) % 360;
      // snap back to north when the user gets close
      if (next < 6 || next > 354) next = 0;
      pending = next;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startAngle = null;
    };

    shell.addEventListener("touchstart", onStart, { passive: true });
    shell.addEventListener("touchmove", onMove, { passive: true });
    shell.addEventListener("touchend", onEnd, { passive: true });
    shell.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      shell.removeEventListener("touchstart", onStart);
      shell.removeEventListener("touchmove", onMove);
      shell.removeEventListener("touchend", onEnd);
      shell.removeEventListener("touchcancel", onEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ready, onRotate]);

  return (
    <div ref={shellRef} className="absolute inset-0 overflow-hidden bg-background">
      <div ref={rotateRef} className="absolute inset-0 will-change-transform">
        <div ref={containerRef} className="absolute inset-0 h-full w-full" />
        <canvas
          ref={fogRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[401] will-change-transform"
        />
        <div className="map-tint" aria-hidden />
      </div>
    </div>
  );
}
