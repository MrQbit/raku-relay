# Architecture

## Control Plane
- Fastify API exposes auth, environment, session, and websocket endpoints.
- Relay issues access, refresh, worker, and trusted-device credentials.
- Durable state is modeled around Postgres entities with Redis reserved for live coordination.

## Execution Modes
- `local_bridge`: RAKU CLI polls for work using an environment secret.
- `raku_cloud`: relay issues a worker token and launches a runner.

## Streaming
- Session events are appended through `/v1/sessions/{id}/events`.
- Clients subscribe through `WS /v1/sessions/ws/{id}/subscribe`.
- Reconnect uses `after_seq` to replay missed events.

