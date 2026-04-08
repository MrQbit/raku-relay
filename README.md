# raku-relay

`raku-relay` is the first-party backend for RAKU Remote Control. It provides
relay-owned auth, bridge environments, durable session state, live session
streaming, worker token issuance, and the control-plane pieces needed for web,
mobile, local bridge, and cloud runner clients.

## Workspace Layout

- `apps/api`: Fastify HTTP and WebSocket API
- `apps/runner`: outbound worker/runner process
- `packages/contracts`: shared schemas and wire types
- `packages/config`: typed environment/config loader
- `packages/auth`: Azure validation and relay token issuance
- `packages/db`: Drizzle schemas and repository types
- `packages/logging`: structured logging helpers
- `infra/terraform`: Azure Container Apps, Postgres, Redis, Storage scaffolding
- `docker`: container build and local-dev compose files
- `docs`: operator and development guides

## Quick Start

1. `bun install`
2. `cp .env.example .env`
3. `bun run dev:api`
4. In another shell, run `bun run test`

For durable local development:

1. `docker compose -f docker/compose.yml up -d`
2. `bun run db:migrate:psql`
3. Set `RAKU_STORAGE_BACKEND=postgres` in `.env`
4. `bun run dev:api`

## Key Docs

- [howto.md](./howto.md)
- [relay-requirements.md](./relay-requirements.md)

## Local Dev Services

`docker/compose.yml` starts Postgres, Redis, and Azurite for local integration.

## Core Scripts

- `bun run dev:api`
- `bun run dev:runner`
- `bun run build`
- `bun run typecheck`
- `bun run test`
- `bun run verify`
