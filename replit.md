# Ventureforth Expedition

A real-world exploration game that turns a player’s surroundings into a coordinate-grid adventure with GPS discovery, photo memories, progress tracking, and multiplayer hunts.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/ventureforth-expedition run dev` — run the expedition web app
- `pnpm --filter @workspace/ventureforth-expedition run typecheck` — typecheck the web app
- `PORT=20357 BASE_PATH=/ pnpm --filter @workspace/ventureforth-expedition run build` — create the production web build
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Web app: React + Vite + TanStack Router + Leaflet
- External services: Supabase Auth, Postgres tables, Storage, and Realtime

## Where things live

- `artifacts/ventureforth-expedition/src/routes/index.tsx` — main expedition game flow
- `artifacts/ventureforth-expedition/src/components/` — map, direction tool, photo memories, multiplayer lobby, and UI primitives
- `artifacts/ventureforth-expedition/src/lib/` — expedition calculations, progress, photos, multiplayer, and session helpers
- `artifacts/ventureforth-expedition/src/integrations/supabase/` — Supabase client and auth integration
- `artifacts/ventureforth-expedition/src/index.css` — analog field-instrument theme

## Architecture decisions

- The expedition frontend keeps the uploaded Supabase-backed behavior rather than duplicating its data model in the workspace API.
- The app runs as a client-side Vite artifact; document-level metadata lives in `index.html`, while TanStack Router owns in-app routes.
- GPS, map, photo storage, and multiplayer features remain real integrations; safe initial loading states handle missing browser permissions or configuration.

## Product

- Sign in or create an account before starting an expedition.
- Use location and heading data to choose a direction and discover mystery destinations.
- Reveal the map through walking, preserve progress, save photo memories, and join timed multiplayer hunts.

## User preferences

- Preserve the uploaded app’s visuals and behavior instead of replacing it with a new design.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
