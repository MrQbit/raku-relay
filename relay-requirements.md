# RAKU Relay Requirements

## Purpose
`raku-relay` is the first-party backend for Remote Control across the RAKU CLI,
web, and future mobile clients. The relay owns session lifecycle, worker token
issuance, websocket fanout, OAuth handoff, token refresh, and trusted-device
enforcement.

## Client Types
- CLI
- Web
- Mobile

## Required V1 Endpoints
- `GET /v1/me`
- `POST /v1/environments/bridge`
- `GET /v1/environments/{id}/work/poll`
- `POST /v1/environments/{id}/work/{workId}/ack`
- `POST /v1/environments/{id}/work/{workId}/stop`
- `POST /v1/environments/{id}/work/{workId}/heartbeat`
- `DELETE /v1/environments/bridge/{id}`
- `POST /v1/environments/{id}/bridge/reconnect`
- `POST /v1/sessions`
- `GET /v1/sessions`
- `GET /v1/sessions/{id}`
- `PATCH /v1/sessions/{id}`
- `POST /v1/sessions/{id}/archive`
- `POST /v1/sessions/{id}/control`
- `POST /v1/sessions/{id}/reply`
- `POST /v1/sessions/{id}/events`
- `GET /v1/environments`
- `GET /v1/environments/{id}`
- `GET /v1/trusted-devices`
- `DELETE /v1/trusted-devices/{id}`
- `WS /v1/sessions/ws/{id}/subscribe`
- `POST /v1/code/sessions`
- `POST /v1/code/sessions/{id}/bridge`
- `POST /v1/code/sessions/{id}/worker/connect`

## Relay-Owned Headers
- `Authorization`
- `x-raku-relay-version`
- `x-raku-client-version`
- `x-raku-runner-version`
- `x-raku-request-origin`
- `X-Trusted-Device-Token`

## OAuth / OIDC
Azure AD is the upstream identity provider. The relay performs token exchange
and issues the runtime credentials used by clients.

### Required Relay Configuration
- `RAKU_AZURE_TENANT_ID`
- `RAKU_AZURE_CLIENT_ID`
- `RAKU_AZURE_ISSUER`
- `RAKU_AZURE_AUDIENCE`
- `RAKU_AZURE_ALLOWED_TENANTS`
- `RAKU_OIDC_REDIRECT_URIS`
- `RAKU_OIDC_SUCCESS_URL`
- `RAKU_OIDC_LOGOUT_URL`

### Azure AD Requirements
- Tenant ID must be configurable.
- Application/client ID must be configurable.
- Issuer and audience validation must be configurable.
- Redirect URIs must be configurable per environment.
- The relay must support local, staging, and production values.
- The relay must support a default tenant plus explicit allowed-tenant policy.

## Relay Token Model
- Access token: relay-issued JWT, 15 minute TTL
- Refresh token: opaque, stored hashed, 30 day rolling TTL
- Worker token: relay-issued JWT, session scoped, 15 minute TTL
- Trusted-device token: opaque, device bound, 90 day rolling TTL

## Persistence
Canonical storage:
- PostgreSQL for metadata and durable session state
- Redis for live coordination, fanout, and reconnect caches
- Blob storage for artifacts, transcripts, and workspace snapshots

## Cloud Execution
- `local_bridge` environments support current CLI bridge registration and work polling.
- `raku_cloud` environments support relay-launched ephemeral runners.
- One runner is launched per active cloud session.
- Worker epochs rotate on new bridge credential issuance.
- Heartbeats extend worker liveness.
- Session archive persists tail state and ends the active lease.

## App-Facing Session Contract
- Session lists must support filtering by status, environment, and recency.
- Environment summaries must expose whether the target is `local_bridge` or
  `raku_cloud`.
- Session control must support `cancel`, `stop`, `archive`, and
  `reconnect_worker`.
- Session replies must support pending permission prompts and other user-input
  requests from browser or mobile clients.
- Websocket session updates must remain the live event channel for active
  sessions.

## Security
- TLS for public HTTP and WebSocket endpoints
- Relay-side ownership checks on all session reads/writes
- Trusted-device enforcement when enabled
- Structured audit logs for login, refresh, bridge attach, reconnect, archive, and privileged failures

## Explicit Exclusions
The relay must not require:
- Anthropic-specific headers
- Anthropic org UUID semantics
- `claude.ai` redirect assumptions
- `anthropic-version`
- `anthropic-beta`
