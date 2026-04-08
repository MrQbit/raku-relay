import type { Config } from 'drizzle-kit'

export default {
  dialect: 'postgresql',
  schema: './packages/db/src/schema.ts',
  out: './packages/db/src/migrations/generated',
  dbCredentials: {
    url: process.env.RAKU_POSTGRES_URL ?? 'postgres://postgres:postgres@localhost:5432/raku_relay',
  },
} satisfies Config

