import { useCallback, useEffect, useRef, useState } from "react";

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/**
 * Live compass heading in degrees (0 = north, clockwise).
 * Uses the device magnetometer when available (the only thing that reacts when
 * you turn on the spot); GPS course is used as a fallback while moving.
 */
export function useHeading() {
  const [heading, setHeading] = useState<number | null>(null);
  const [source, setSource] = useState<"compass" | "gps" | null>(null);
  const smoothed = useRef<number | null>(null);
  const hasCompass = useRef(false);
  const frame = useRef(0);
  const pending = useRef<{ heading: number; source: "compass" | "gps" } | null>(null);

  const push = useCallback((deg: number, src: "compass" | "gps") => {
    if (src === "gps" && hasCompass.current) return;
    const norm = ((deg % 360) + 360) % 360;
    const prev = smoothed.current;
    // circular smoothing to kill magnetometer jitter
    let next = norm;
    if (prev !== null) {
      const delta = ((norm - prev + 540) % 360) - 180;
      next = (((prev + delta * 0.35) % 360) + 360) % 360;
    }
    smoothed.current = next;
    pending.current = { heading: next, source: src };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const value = pending.current;
      if (!value) return;
      setHeading((current) => {
        if (current !== null) {
          const delta = Math.abs(((value.heading - current + 540) % 360) - 180);
          if (delta < 1) return current;
        }
        return value.heading;
      });
      setSource((current) => (current === value.source ? current : value.source));
    });
  }, []);

  const start = useCallback(() => {
    if (typeof window === "undefined") return;

    const onOrient = (e: Event) => {
      const ev = e as OrientationEvent;
      let deg: number | null = null;
      if (typeof ev.webkitCompassHeading === "number") {
        deg = ev.webkitCompassHeading;
      } else if (ev.alpha !== null && ev.alpha !== undefined) {
        deg =
          ev.absolute || e.type === "deviceorientationabsolute" ? 360 - ev.alpha : 360 - ev.alpha;
      }
      if (deg === null || Number.isNaN(deg)) return;
      hasCompass.current = true;
      push(deg, "compass");
    };

    const attach = () => {
      if ("ondeviceorientationabsolute" in window) {
        window.addEventListener("deviceorientationabsolute", onOrient, true);
      }
      window.addEventListener("deviceorientation", onOrient, true);
    };

    const anyDOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (typeof anyDOE?.requestPermission === "function") {
      anyDOE
        .requestPermission()
        .then((r) => {
          if (r === "granted") attach();
        })
        .catch(() => {});
    } else {
      attach();
    }

    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrient, true);
      window.removeEventListener("deviceorientation", onOrient, true);
    };
  }, [push]);

  const detachRef = useRef<(() => void) | void>(undefined);
  const begin = useCallback(() => {
    if (detachRef.current) return;
    detachRef.current = start();
  }, [start]);

  useEffect(
    () => () => {
      detachRef.current?.();
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const pushGps = useCallback((deg: number) => push(deg, "gps"), [push]);

  return { heading, source, begin, pushGps };
}
