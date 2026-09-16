---
name: Multiplayer hazard performance
description: Performance constraint for temporary multiplayer map hazards.
---

Temporary multiplayer hazards should be computed locally from the player's active route, rendered as one Leaflet overlay, and driven by one interval per active hunt. Read live coordinates through refs instead of recreating timers on GPS updates.

**Why:** GPS updates arrive frequently and Realtime already carries player movement; adding database writes, broadcast traffic, or a timer tied to every coordinate update would make a short-lived visual mechanic compete with the map and fog renderer.

**How to apply:** Keep the hazard lifecycle in a focused hook, use deterministic per-room/player randomness when personal hazards are acceptable, and put visual animation in CSS/DOM rather than React state.