# Plan: Smooth X/Z coordinate progression

## Problem
Each GPS fix arrives a few metres away from the previous one (and jitters even
when standing still). The coordinate console reads straight from the raw fix,
so at the 5× scale the numbers leap — 40 → 56 → 71 — instead of counting up
smoothly.

## Fix
Interpolate between GPS fixes so the on-screen position glides instead of
teleporting.

1. **Smoothed player position** in `src/routes/index.tsx`
   - Keep the raw GPS fix as the target, but drive a separate "display"
     position with a per-frame animation (`requestAnimationFrame`) that eases
     toward the target (exponential smoothing, ~0.5 s to converge).
   - While standing still, a small deadband (~1.5 m) ignores jitter so the
     numbers hold steady instead of bouncing.
2. **Coordinates from the smoothed position**
   - `gameCoords(player)` and the map marker use the smoothed position, so X
     and Z tick through consecutive integers (40, 41, 42 …) as you walk.
   - X still changes only with east/west movement, Z only with north/south —
     the fixed-origin grid from the last change is untouched.
3. **Everything else stays the same**
   - Fog reveal, trail recording, arrival detection and saving keep using the
     raw GPS fixes, so gameplay accuracy is unaffected.

## Performance
One lightweight animation loop that only runs while the expedition screen is
active and the position is moving — no extra GPS reads, no extra saves, no
impact on the map's smoothness.

## Files touched
- `src/routes/index.tsx` (smoothing hook + wire-up)
- possibly a tiny helper in `src/lib/expedition.ts`

## Verification
- Typecheck/build pass.
- Preview loads the expedition screen; coordinate console updates continuously
  with no backward jumps while the position moves.
