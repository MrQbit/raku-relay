# RAKU Relay How-To

## Maintenance Rule
This document is part of the product surface, not optional documentation.
Whenever we change relay behavior, deployment shape, storage, auth flow,
headers, runtime assumptions, or runner lifecycle, we should update this file
in the same change.

## What `raku-relay` Is For
`raku-relay` is the backend that makes Remote Control possible across the RAKU
CLI today and web or mobile clients later.

It exists to solve four problems:

1. Identity and session ownership.
2. Durable session state and live event streaming.
3. Bridge dispatch to local CLI workers.
4. Relay-owned cloud execution through runner processes.

In practice that means the relay:
- accepts Azure AD identity and exchanges it for relay-issued runtime tokens
- stores users, environments, sessions, work items, and session events
- lets a local CLI environment register itself and poll for work
- lets a cloud runner connect with a worker token and stream session events
- provides websocket fanout so multiple clients can observe the same session

## What It Is Not For
`raku-relay` is not:
- a generic public API gateway
- a replacement for the actual RAKU agent runtime
- a browser frontend
- a mobile app
- a secret manager for arbitrary third-party applications
- a multi-tenant business workflow engine

The relay coordinates sessions and workers. It does not itself replace the
agent logic that runs inside the CLI or runner process.

## Core Use Cases

### 1. Local Remote Control
A user signs in, registers a machine as a bridge environment, and the local
RAKU CLI polls the relay for work. When a session is targeted at that
environment, the relay returns a work item and the CLI begins executing.

### 2. Cloud Execution
A user creates a cloud session. The relay creates the session, issues a
worker token, launches a runner, and the runner connects back to the relay
to stream events and results.

### 3. Shared Session Viewing
Because sessions and events are durable, a second client such as a web UI can
attach to the same session and consume updates over websocket without needing
to be the worker itself.

## Conceptual Model

```mermaid
flowchart LR
  User["User"] --> CLI["RAKU CLI"]
  User --> Web["Web UI (later)"]
  User --> Mobile["Mobile UI (later)"]
  CLI --> Relay["raku-relay API"]
  Web --> Relay
  Mobile --> Relay
  Relay --> PG["PostgreSQL"]
  Relay --> Redis["Redis"]
  Relay --> Blob["Blob Storage"]
  Relay --> Runner["Cloud Runner"]
```

## Main Components

- API service: accepts auth, session, environment, and worker traffic
- PostgreSQL: durable source of truth for users, sessions, work, and events
- Redis: live pub/sub for session event fanout across processes
- Runner: outbound worker that executes cloud sessions and posts session events
- Azure AD: upstream identity provider
- Blob storage: artifacts, logs, snapshots, and later workspace bundles

## Auth Flow

The relay uses Azure AD only as the upstream identity provider. Runtime calls
use relay-issued credentials, not raw Azure tokens.

```mermaid
sequenceDiagram
  participant User
  participant Client as RAKU Client
  participant Azure as Azure AD
  participant Relay as raku-relay

  User->>Client: Sign in
  Client->>Azure: OIDC login
  Azure-->>Client: ID token
  Client->>Relay: POST /v1/auth/azure/exchange
  Relay->>Relay: Validate issuer, audience, tenant
  Relay-->>Client: access token + refresh token
  Client->>Relay: Runtime API calls with relay bearer token
```

## Local Bridge Flow

```mermaid
sequenceDiagram
  participant CLI as Local RAKU CLI
  participant Relay as raku-relay
  participant User

  User->>CLI: Start remote-control bridge
  CLI->>Relay: POST /v1/environments/bridge
  Relay-->>CLI: environment_id + environment_secret
  CLI->>Relay: GET /v1/environments/{id}/work/poll
  User->>Relay: Create session against that environment
  Relay-->>CLI: queued work item
  CLI->>Relay: POST ack / heartbeat / stop
  CLI->>Relay: POST /v1/sessions/{id}/events
  Relay-->>Observers: websocket session updates
```

## Cloud Runner Flow

```mermaid
sequenceDiagram
  participant Client as RAKU Client
  participant Relay as raku-relay
  participant Runner as raku-runner
  participant PG as PostgreSQL
  participant Redis as Redis

  Client->>Relay: POST /v1/code/sessions
  Relay->>PG: Create session
  Relay->>Relay: Issue worker token and bump worker epoch
  Relay->>Runner: Launch runner process or job
  Runner->>Relay: POST /v1/code/sessions/{id}/worker/connect
  Runner->>Relay: POST /v1/sessions/{id}/events
  Relay->>PG: Persist event
  Relay->>Redis: Publish session event
  Relay-->>Client: Websocket session update
```

## Storage Model

### PostgreSQL
PostgreSQL is the durable system of record for:
- users
- user identities
- refresh tokens
- trusted devices
- environments
- sessions
- session events
- work items
- worker credentials

### Redis
Redis is for live coordination:
- websocket fanout
- cross-process event delivery
- future worker lease coordination
- future reconnect cursors and ephemeral prompts

### Blob Storage
Blob storage is for:
- runner logs
- artifacts
- transcript bundles
- future workspace snapshots

## Current Backend Modes

### `memory`
Use this for local development or tests where durability is not required.

### `postgres`
Use this for real deployments. In the current codebase this means:
- Postgres for durable records
- Redis for live event pub/sub

## API Surface

Current core endpoints:
- `POST /v1/auth/azure/exchange`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `POST /v1/auth/trusted-devices`
- `POST /v1/environments/bridge`
- `GET /v1/environments/{id}/work/poll`
- `POST /v1/environments/{id}/work/{workId}/ack`
- `POST /v1/environments/{id}/work/{workId}/stop`
- `POST /v1/environments/{id}/work/{workId}/heartbeat`
- `POST /v1/sessions`
- `GET /v1/sessions/{id}`
- `PATCH /v1/sessions/{id}`
- `POST /v1/sessions/{id}/archive`
- `POST /v1/sessions/{id}/events`
- `WS /v1/sessions/ws/{id}/subscribe`
- `POST /v1/code/sessions`
- `POST /v1/code/sessions/{id}/bridge`
- `POST /v1/code/sessions/{id}/worker/connect`

## Local Deployment

### Prerequisites
- Bun
- Docker
- PostgreSQL and Redis, or Docker Compose

### 1. Start dependencies
```bash
docker compose -f docker/compose.yml up -d
```

### 2. Create configuration
```bash
cp .env.example .env
```

For durable mode set:
```bash
RAKU_STORAGE_BACKEND=postgres
RAKU_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/raku_relay
RAKU_REDIS_URL=redis://localhost:6379
```

### 3. Apply the schema
Use the SQL migration:
```bash
psql postgres://postgres:postgres@localhost:5432/raku_relay -f packages/db/src/migrations/0000_initial.sql
```

### 4. Start the API
```bash
bun run dev:api
```

### 5. Optional: enable local cloud-runner launching
Set:
```bash
RAKU_LOCAL_RUNNER_COMMAND="bun run apps/runner/src/index.ts"
```

Then create a `raku_cloud` session through the API and the relay will spawn a
local runner process.

## Azure Deployment Shape

The intended production deployment looks like this:

```mermaid
flowchart TD
  FrontDoor["Azure Front Door / HTTPS"] --> API["Azure Container Apps: relay API"]
  API --> PG["Azure Database for PostgreSQL"]
  API --> Redis["Azure Cache for Redis"]
  API --> Blob["Azure Blob Storage"]
  API --> Jobs["Azure Container Apps Jobs: runners"]
  AzureAD["Azure AD"] --> API
```

### Suggested Production Steps
1. Provision PostgreSQL, Redis, Blob Storage, and Container Apps environment.
2. Configure Azure AD application registration.
3. Set relay environment variables:
   - `RAKU_AZURE_TENANT_ID`
   - `RAKU_AZURE_CLIENT_ID`
   - `RAKU_AZURE_ISSUER`
   - `RAKU_AZURE_AUDIENCE`
   - `RAKU_AZURE_ALLOWED_TENANTS`
   - `RAKU_OIDC_REDIRECT_URIS`
   - `RAKU_OIDC_SUCCESS_URL`
   - `RAKU_OIDC_LOGOUT_URL`
   - `RAKU_STORAGE_BACKEND=postgres`
   - `RAKU_POSTGRES_URL`
   - `RAKU_REDIS_URL`
4. Apply the migration SQL to PostgreSQL.
5. Deploy the API container.
6. Deploy the runner container image.
7. Configure runner launch integration for Container Apps Jobs.

## Operational Notes

### What happens if Redis is down?
- Durable session/event state remains in Postgres.
- Live fanout degrades.
- Reconnect replay should still work through persisted `session_events`.

### What happens if Postgres is down?
- The relay cannot safely create or mutate durable session state.
- Runtime should be treated as degraded or unavailable.

### Why do we still keep `memory` mode?
- Fast local tests
- isolated development without infrastructure
- easier debugging of pure API logic

It is not appropriate for production.

## Not Yet Finished
These areas still need more work before calling the relay production-complete:
- automatic migration runner
- first-class worker lease reconciliation in Redis
- actual Azure Container Apps Job launcher integration
- blob-backed workspace/artifact persistence
- richer websocket replay/resume semantics
- stronger multi-process observability and metrics

## Change Checklist
When changing relay behavior, update this file if you touch:
- auth or token flow
- storage backend behavior
- endpoint contracts
- runner lifecycle
- deployment steps
- infrastructure requirements
- diagrams that no longer match runtime reality
