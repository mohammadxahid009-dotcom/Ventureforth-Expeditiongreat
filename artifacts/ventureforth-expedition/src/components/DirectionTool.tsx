import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Cone, LatLng } from "@/lib/expedition";
import { destinationFrom, formatDistance } from "@/lib/expedition";

type Props = {
  map: L.Map;
  player: LatLng;
  cone: Cone;
  onChange: (c: Cone) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
};

const DEG = Math.PI / 180;

function metresToPixels(map: L.Map, metres: number) {
  const c = map.getCenter();
  const a = map.latLngToContainerPoint(c);
  const east = destinationFrom({ lat: c.lat, lng: c.lng }, 90, metres);
  const b = map.latLngToContainerPoint(L.latLng(east.lat, east.lng));
  return Math.max(1, Math.abs(b.x - a.x));
}

export default function DirectionTool({
  map,
  player,
  cone,
  onChange,
  onConfirm,
  onCancel,
  busy,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [, setTick] = useState(0);
  const drag = useRef<"tip" | "width" | null>(null);

  useEffect(() => {
    const r = () => setTick((t) => t + 1);
    map.on("move zoom resize", r);
    return () => {
      map.off("move zoom resize", r);
    };
  }, [map]);

  const size = map.getSize();
  const origin = map.latLngToContainerPoint(L.latLng(player.lat, player.lng));
  const pxPerM = metresToPixels(map, 1000) / 1000;
  const len = cone.length * pxPerM;

  const pt = (bearing: number, dist: number) => ({
    x: origin.x + Math.sin(bearing * DEG) * dist,
    y: origin.y - Math.cos(bearing * DEG) * dist,
  });

  const left = pt(cone.bearing - cone.halfWidth, len);
  const right = pt(cone.bearing + cone.halfWidth, len);
  const tip = pt(cone.bearing, len);
  const widthHandle = pt(cone.bearing + cone.halfWidth, len * 0.72);

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - origin.x;
    const y = e.clientY - rect.top - origin.y;
    const dist = Math.hypot(x, y);
    const ang = (Math.atan2(x, -y) / DEG + 360) % 360;
    if (drag.current === "tip") {
      const metres = Math.min(12000, Math.max(800, dist / pxPerM));
      onChange({ ...cone, bearing: ang, length: metres });
    } else {
      const delta = ((ang - cone.bearing + 540) % 360) - 180;
      onChange({ ...cone, halfWidth: Math.min(70, Math.max(6, Math.abs(delta))) });
    }
  };

  const end = () => (drag.current = null);

  return (
    <>
      <svg
        ref={svgRef}
        className="absolute inset-0 z-[520] touch-none"
        width={size.x}
        height={size.y}
        style={{ pointerEvents: drag.current ? "auto" : "none" }}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <defs>
          <radialGradient id="coneFill" cx="50%" cy="100%" r="100%">
            <stop offset="0%" stopColor="oklch(0.8 0.15 78)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="oklch(0.8 0.15 78)" stopOpacity="0.08" />
          </radialGradient>
        </defs>
        <path
          d={`M ${origin.x} ${origin.y} L ${left.x} ${left.y} A ${len} ${len} 0 0 1 ${right.x} ${right.y} Z`}
          fill="url(#coneFill)"
          stroke="oklch(0.86 0.15 78)"
          strokeWidth={1.5}
          strokeDasharray="6 6"
        />
        <line
          x1={origin.x}
          y1={origin.y}
          x2={tip.x}
          y2={tip.y}
          stroke="oklch(0.86 0.15 78 / 0.5)"
          strokeWidth={1}
        />
        <text
          x={origin.x + 14}
          y={origin.y + 4}
          fill="oklch(0.94 0.012 90)"
          fontSize="10"
          letterSpacing="2"
        >
          YOU
        </text>

        {/* distance / direction handle */}
        <g
          style={{ pointerEvents: "auto", cursor: "grab" }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            drag.current = "tip";
          }}
        >
          <circle cx={tip.x} cy={tip.y} r={20} fill="transparent" />
          <circle
            cx={tip.x}
            cy={tip.y}
            r={11}
            fill="oklch(0.2 0.02 250)"
            stroke="oklch(0.86 0.15 78)"
            strokeWidth={2}
          />
          <text
            x={tip.x}
            y={tip.y - 20}
            textAnchor="middle"
            fill="oklch(0.86 0.15 78)"
            fontSize="10"
          >
            {formatDistance(cone.length)}
          </text>
        </g>

        {/* width handle */}
        <g
          style={{ pointerEvents: "auto", cursor: "grab" }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            drag.current = "width";
          }}
        >
          <circle cx={widthHandle.x} cy={widthHandle.y} r={20} fill="transparent" />
          <circle
            cx={widthHandle.x}
            cy={widthHandle.y}
            r={9}
            fill="oklch(0.2 0.02 250)"
            stroke="oklch(0.94 0.012 90)"
            strokeWidth={2}
          />
          <text
            x={widthHandle.x + 14}
            y={widthHandle.y + 4}
            fill="oklch(0.94 0.012 90)"
            fontSize="10"
          >
            {Math.round(cone.halfWidth * 2)}°
          </text>
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[540] p-3">
        <div className="panel pointer-events-auto rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            Choose a direction to explore
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Drag the far handle to aim and set range. Drag the side handle to widen the search zone.
            The app picks the spot.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 rounded-xl border border-border px-3 py-3 text-[10px] tracking-[0.18em] text-muted-foreground"
            >
              CANCEL
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="flex-[2] rounded-xl bg-primary px-3 py-3 text-[10px] font-bold tracking-[0.2em] text-primary-foreground disabled:opacity-70"
            >
              {busy ? "SCOUTING…" : "SEND ME THERE"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
