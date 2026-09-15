# Shared global coordinate system

## Goal
Replace the session-based coordinates with one permanent world grid. Every player standing at the same real location will see the same complete address, and a shared target address will always resolve to one real-world point.

Chosen display:

```text
SECTOR 2HJ-4YD
X 2,312   Z -4,324
```

The **sector and X/Z together** form the location address. X/Z remain small and readable; the short sector supplies the global context that small numbers alone cannot contain.

## Changes
1. **Create a fixed global grid**
   - Divide the world into fixed geographic sectors approximately 4 km across.
   - Give every sector a deterministic, compact alphanumeric ID derived from its global row and column; it does not depend on the player or session.
   - Calculate local X/Z from the sector centre at the existing responsive scale of 5 coordinate units per metre.
   - X changes only east/west and Z only north/south.

2. **Make addresses reversible**
   - Add conversion in both directions: real latitude/longitude → sector + X/Z, and sector + X/Z → real latitude/longitude.
   - Round to 0.2-metre coordinate resolution, enough for a shared destination to resolve to effectively the same GPS point for all players.
   - Reject malformed or impossible sector addresses safely.

3. **Update the expedition display**
   - Remove the session-specific zero point and its startup initialization.
   - Show the current location’s global sector and local X/Z.
   - Show the destination’s own sector alongside its X/Z, since a 2–7 km expedition may cross into another sector.
   - Keep coordinate smoothing, so the displayed X/Z still count progressively between GPS updates.

4. **Preserve existing expeditions**
   - Continue saving destinations internally as latitude/longitude, so current saved quests remain valid.
   - Derive their new global address when displayed; no database migration or multiplayer work is needed.

## Boundary behavior
Crossing a sector edge changes the sector ID and resets local X/Z to the neighbouring sector’s range. This is necessary to keep X/Z small while retaining one canonical global address. It happens only at a sector boundary; normal movement within a sector remains smooth.

## Technical details
- Replace `setCoordOrigin` and the session-relative `gameCoords` calculation in `src/lib/expedition.ts` with canonical `globalAddress` and reverse-conversion helpers.
- Use fixed 0.04° sector cells, base-36 row/column IDs, Earth-radius projection around each sector centre, and the existing 5× coordinate scale.
- Update coordinate and sector usage in `src/routes/index.tsx`.
- Add focused tests for same-location consistency, different-player independence, round-trip conversion, axis isolation, sector boundaries, and invalid addresses.

## Verification
- Two calculations for the same GPS point produce an identical sector/X/Z address regardless of starting location.
- Decoding a displayed address returns its original real location within about 0.2 metres.
- Moving east/west changes only X; moving north/south changes only Z while inside one sector.
- Existing saved destinations still load and display correctly.
- App checks pass and the expedition screen is inspected at desktop and phone sizes.

## Not included
- Multiplayer players, races, shared hunt records, or matchmaking.
- The paused flag-button feedback change.
