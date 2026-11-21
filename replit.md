# AlgoArena

Real-time 1v1 Python algorithm battles: two players solve the same challenge, earn points, and attack each other's hearts.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/algoarena run dev` — run the AlgoArena web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Current app flows do not require environment variables.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React, Vite, Monaco Editor
- API: Express 5 and WebSockets (`ws`)
- Judge: Python 3 with AST allowlisting and process limits
- The current game state is in memory; PostgreSQL and Drizzle are available in the workspace but are not used by this prototype.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/algoarena/src/pages/` — lobby and live match interface
- `artifacts/algoarena/src/index.css` — visual theme and match animations
- `artifacts/api-server/src/routes/arena.ts` — challenge, room, and submission API
- `artifacts/api-server/src/lib/` — challenge repository, in-memory room state, WebSockets, and Python judge
- `lib/api-spec/openapi.yaml` — source of truth for generated API contracts

## Architecture decisions

- Live rooms and submission history exist only in the API process; a restart ends active rooms.
- The Python judge accepts a restricted AST subset, disallows imports, and applies child-process limits. This is not equivalent to a dedicated OS sandbox for hostile public submissions.
- The API artifact must route both `/api` and `/ws` so browser WebSocket connections reach the battle server.

## Product

- User-facing product copy, challenge descriptions, and UI errors are in Korean. Every challenge entry point uses `def solution(...)`; keep API routes and protocol enums unchanged in English.
- Choose Bronze, Silver, or Gold; each tier has five challenges, and each match randomly selects three.
- Both players progress through the same three challenges independently; accepted submissions award points and damage, with the timer and hearts deciding the match.
- Create a room and invite a rival with its code; run public tests and submit against hidden tests for real-time verdict and attack updates.
- Matches support two browser sessions connected to the same API process.

## User preferences

No additional preferences recorded.

## Gotchas

- Monaco's default loader fetches editor assets from a CDN, so the editor needs browser network access.
- The judge accepts a restricted Python AST subset and is not a full OS sandbox; use a dedicated isolated runner before opening this to hostile public submissions.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
