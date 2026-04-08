import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  tenantId: varchar('tenant_id', { length: 128 }).notNull(),
  email: varchar('email', { length: 320 }),
  displayName: varchar('display_name', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const userIdentities = pgTable('user_identities', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  tenantId: varchar('tenant_id', { length: 128 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const tenants = pgTable('tenants', {
  id: varchar('id', { length: 128 }).primaryKey(),
  name: varchar('name', { length: 255 }),
  isAllowed: boolean('is_allowed').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const trustedDevices = pgTable('trusted_devices', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  label: varchar('label', { length: 120 }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  replacedByTokenId: uuid('replaced_by_token_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const environments = pgTable('environments', {
  id: uuid('id').primaryKey(),
  ownerUserId: uuid('owner_user_id').notNull(),
  kind: varchar('kind', { length: 32 }).notNull(),
  machineName: varchar('machine_name', { length: 255 }).notNull(),
  directory: text('directory').notNull(),
  branch: varchar('branch', { length: 255 }),
  gitRepoUrl: text('git_repo_url'),
  maxSessions: integer('max_sessions').notNull().default(1),
  metadata: jsonb('metadata'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const environmentBridgeRegistrations = pgTable(
  'environment_bridge_registrations',
  {
    id: uuid('id').primaryKey(),
    environmentId: uuid('environment_id').notNull(),
    secretHash: text('secret_hash').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
)

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  ownerUserId: uuid('owner_user_id').notNull(),
  environmentId: uuid('environment_id'),
  status: varchar('status', { length: 32 }).notNull(),
  title: varchar('title', { length: 255 }),
  metadata: jsonb('metadata'),
  workerEpoch: integer('worker_epoch').notNull().default(0),
  lastEventSeq: integer('last_event_seq').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
})

export const sessionEvents = pgTable('session_events', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull(),
  seq: integer('seq').notNull(),
  type: varchar('type', { length: 128 }).notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const sessionSubscribers = pgTable('session_subscribers', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull(),
  userId: uuid('user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const workItems = pgTable('work_items', {
  id: uuid('id').primaryKey(),
  environmentId: uuid('environment_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
})

export const workerLeases = pgTable('worker_leases', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull(),
  workerEpoch: integer('worker_epoch').notNull(),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const workerCredentials = pgTable('worker_credentials', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull(),
  workerEpoch: integer('worker_epoch').notNull(),
  tokenJti: varchar('token_jti', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey(),
  actorUserId: uuid('actor_user_id'),
  action: varchar('action', { length: 128 }).notNull(),
  targetType: varchar('target_type', { length: 64 }).notNull(),
  targetId: varchar('target_id', { length: 255 }).notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

