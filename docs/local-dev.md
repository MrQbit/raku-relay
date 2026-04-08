# Local Development

1. Start dependencies with `docker compose -f docker/compose.yml up -d`.
2. Copy `.env.example` to `.env`.
3. Set `RAKU_STORAGE_BACKEND=postgres` if you want the durable backend instead of the default in-memory mode.
4. Apply `packages/db/src/migrations/0000_initial.sql` to your local Postgres database.
3. Run `bun install`.
4. Start the API with `bun run dev:api`.
5. Start a runner manually with `bun run dev:runner` after exporting the session-specific environment variables.

For local cloud-flow testing, set `RAKU_LOCAL_RUNNER_COMMAND` so the API can
spawn a runner process when a `raku_cloud` session is created.

See [/Volumes/ML/raku-relay/howto.md](/Volumes/ML/raku-relay/howto.md) for the full relay behavior and deployment model.
