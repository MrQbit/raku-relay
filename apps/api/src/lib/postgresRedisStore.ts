import { randomUUID } from 'crypto'
import postgres, { type Sql } from 'postgres'
import { createClient } from 'redis'
import { sha256, type AzureIdentity } from '@raku-relay/auth'
import type {
  CreateCodeSessionInput,
  CreateSessionInput,
  SessionEventEnvelope,
  SessionStatus,
  UpdateSessionInput,
} from '@raku-relay/contracts'
import {
  type EnvironmentRecord,
  type EnvironmentUpsertInput,
  type RefreshTokenRecord,
  type RelayStore,
  type SessionRecord,
  type TrustedDeviceRecord,
  type UserRecord,
  type WorkItemRecord,
  type WorkerCredentialRecord,
} from './store.js'

type JsonValue = Record<string, unknown> | null

type PostgresRedisStoreOptions = {
  postgresUrl: string
  redisUrl: string
  channelPrefix?: string
}

type UserRow = {
  id: string
  tenant_id: string
  email: string | null
  display_name: string | null
  created_at: string
  updated_at: string
  subject: string
}

type EnvironmentRow = {
  id: string
  owner_user_id: string
  kind: string
  machine_name: string
  directory: string
  branch: string | null
  git_repo_url: string | null
  max_sessions: number
  metadata: JsonValue
  created_at: string
  updated_at: string
  archived_at: string | null
  secret_hash: string
}

type SessionRow = {
  id: string
  owner_user_id: string
  environment_id: string | null
  title: string | null
  status: string
  metadata: JsonValue
  worker_epoch: number
  last_event_seq: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

type RefreshTokenRow = {
  id: string
  user_id: string
  token_hash: string
  expires_at: Date
  revoked_at: Date | null
  replaced_by_token_id: string | null
}

type TrustedDeviceRow = {
  id: string
  user_id: string
  label: string
  token_hash: string
  expires_at: Date
  last_used_at: Date | null
}

type WorkItemRow = {
  id: string
  environment_id: string
  session_id: string
  token: string
  token_hash: string
  status: 'queued' | 'claimed' | 'stopped' | 'completed'
  created_at: string
  claimed_at: string | null
  heartbeat_at: string | null
}

type WorkerCredentialRow = {
  session_id: string
  worker_epoch: number
  token_jti: string
  expires_at: Date
  connected_at: Date | null
}

function asRecord(value: JsonValue): Record<string, unknown> {
  return value ?? {}
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name,
    subject: row.subject,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEnvironment(row: EnvironmentRow): EnvironmentRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    kind: row.kind as EnvironmentRecord['kind'],
    machineName: row.machine_name,
    directory: row.directory,
    branch: row.branch ?? undefined,
    gitRepoUrl: row.git_repo_url ?? undefined,
    maxSessions: row.max_sessions,
    metadata: asRecord(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
    secretHash: row.secret_hash,
  }
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    environmentId: row.environment_id ?? undefined,
    title: row.title,
    status: row.status as SessionRecord['status'],
    metadata: asRecord(row.metadata),
    workerEpoch: row.worker_epoch,
    lastEventSeq: row.last_event_seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
  }
}

function mapRefreshToken(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.getTime(),
    revokedAt: row.revoked_at?.getTime(),
    replacedByTokenId: row.replaced_by_token_id ?? undefined,
  }
}

function mapTrustedDevice(row: TrustedDeviceRow): TrustedDeviceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.getTime(),
    lastUsedAt: row.last_used_at?.getTime(),
  }
}

function mapWorkItem(row: WorkItemRow): WorkItemRecord {
  return {
    id: row.id,
    environmentId: row.environment_id,
    sessionId: row.session_id,
    token: row.token,
    tokenHash: row.token_hash,
    status: row.status,
    createdAt: row.created_at,
    claimedAt: row.claimed_at ?? undefined,
    heartbeatAt: row.heartbeat_at ?? undefined,
  }
}

function mapWorkerCredential(row: WorkerCredentialRow): WorkerCredentialRecord {
  return {
    sessionId: row.session_id,
    workerEpoch: row.worker_epoch,
    tokenJti: row.token_jti,
    expiresAt: row.expires_at.getTime(),
    connectedAt: row.connected_at?.getTime(),
  }
}

export class PostgresRedisRelayStore implements RelayStore {
  private constructor(
    private readonly sql: Sql,
    private readonly publisher: ReturnType<typeof createClient>,
    private readonly subscriber: ReturnType<typeof createClient>,
    private readonly channelPrefix: string,
  ) {}

  static async create(
    options: PostgresRedisStoreOptions,
  ): Promise<PostgresRedisRelayStore> {
    const sql = postgres(options.postgresUrl, {
      max: 5,
      prepare: false,
    })
    const publisher = createClient({ url: options.redisUrl })
    const subscriber = publisher.duplicate()
    await publisher.connect()
    await subscriber.connect()
    return new PostgresRedisRelayStore(
      sql,
      publisher,
      subscriber,
      options.channelPrefix ?? 'raku-relay',
    )
  }

  async upsertUser(identity: AzureIdentity): Promise<UserRecord> {
    const lookup = await this.sql<UserRow[]>`
      select u.id, u.tenant_id, u.email, u.display_name, u.created_at, u.updated_at, ui.subject
      from user_identities ui
      join users u on u.id = ui.user_id
      where ui.provider = 'azuread'
        and ui.subject = ${identity.subject}
        and ui.tenant_id = ${identity.tenantId}
      limit 1
    `
    const now = new Date().toISOString()
    if (lookup[0]) {
      const userId = lookup[0].id
      await this.sql`
        update users
        set tenant_id = ${identity.tenantId},
            email = ${identity.email},
            display_name = ${identity.displayName},
            updated_at = ${now}
        where id = ${userId}
      `
      const refreshed = await this.sql<UserRow[]>`
        select u.id, u.tenant_id, u.email, u.display_name, u.created_at, u.updated_at, ui.subject
        from user_identities ui
        join users u on u.id = ui.user_id
        where ui.provider = 'azuread'
          and ui.subject = ${identity.subject}
          and ui.tenant_id = ${identity.tenantId}
        limit 1
      `
      return mapUser(refreshed[0])
    }
    const userId = randomUUID()
    const identityId = randomUUID()
    await this.sql.begin(async tx => {
      await tx`
        insert into users (id, tenant_id, email, display_name, subject, created_at, updated_at)
        values (${userId}, ${identity.tenantId}, ${identity.email}, ${identity.displayName}, ${identity.subject}, ${now}, ${now})
      `
      await tx`
        insert into user_identities (id, user_id, provider, subject, tenant_id, created_at)
        values (${identityId}, ${userId}, 'azuread', ${identity.subject}, ${identity.tenantId}, ${now})
      `
    })
    return {
      id: userId,
      tenantId: identity.tenantId,
      email: identity.email,
      displayName: identity.displayName,
      subject: identity.subject,
      createdAt: now,
      updatedAt: now,
    }
  }

  async getUser(userId: string): Promise<UserRecord | undefined> {
    const rows = await this.sql<UserRow[]>`
      select id, tenant_id, email, display_name, created_at, updated_at, subject
      from users
      where id = ${userId}
      limit 1
    `
    return rows[0] ? mapUser(rows[0]) : undefined
  }

  async createRefreshToken(
    userId: string,
    tokenHash: string,
    expiresAt: number,
  ): Promise<RefreshTokenRecord> {
    const id = randomUUID()
    const rows = await this.sql<RefreshTokenRow[]>`
      insert into refresh_tokens (id, user_id, token_hash, expires_at, created_at)
      values (${id}, ${userId}, ${tokenHash}, ${new Date(expiresAt)}, ${new Date().toISOString()})
      returning id, user_id, token_hash, expires_at, revoked_at, replaced_by_token_id
    `
    return mapRefreshToken(rows[0])
  }

  async rotateRefreshToken(
    oldTokenHash: string,
    newTokenHash: string,
    expiresAt: number,
  ): Promise<{ current: RefreshTokenRecord; next: RefreshTokenRecord } | null> {
    return this.sql.begin(async tx => {
      const currentRows = await tx<RefreshTokenRow[]>`
        select id, user_id, token_hash, expires_at, revoked_at, replaced_by_token_id
        from refresh_tokens
        where token_hash = ${oldTokenHash}
        limit 1
      `
      const current = currentRows[0]
      if (!current || current.revoked_at || current.expires_at.getTime() < Date.now()) {
        return null
      }
      const nextId = randomUUID()
      await tx`
        update refresh_tokens
        set revoked_at = ${new Date().toISOString()}, replaced_by_token_id = ${nextId}
        where id = ${current.id}
      `
      const nextRows = await tx<RefreshTokenRow[]>`
        insert into refresh_tokens (id, user_id, token_hash, expires_at, created_at)
        values (${nextId}, ${current.user_id}, ${newTokenHash}, ${new Date(expiresAt)}, ${new Date().toISOString()})
        returning id, user_id, token_hash, expires_at, revoked_at, replaced_by_token_id
      `
      const refreshedRows = await tx<RefreshTokenRow[]>`
        select id, user_id, token_hash, expires_at, revoked_at, replaced_by_token_id
        from refresh_tokens
        where id = ${current.id}
        limit 1
      `
      return {
        current: mapRefreshToken(refreshedRows[0]),
        next: mapRefreshToken(nextRows[0]),
      }
    })
  }

  async getRefreshToken(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | undefined> {
    const rows = await this.sql<RefreshTokenRow[]>`
      select id, user_id, token_hash, expires_at, revoked_at, replaced_by_token_id
      from refresh_tokens
      where token_hash = ${tokenHash}
      limit 1
    `
    return rows[0] ? mapRefreshToken(rows[0]) : undefined
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.sql`
      update refresh_tokens
      set revoked_at = ${new Date().toISOString()}
      where token_hash = ${tokenHash}
    `
  }

  async createTrustedDevice(
    userId: string,
    label: string,
    tokenHash: string,
    expiresAt: number,
  ): Promise<TrustedDeviceRecord> {
    const id = randomUUID()
    const rows = await this.sql<TrustedDeviceRow[]>`
      insert into trusted_devices (id, user_id, label, token_hash, expires_at, created_at)
      values (${id}, ${userId}, ${label}, ${tokenHash}, ${new Date(expiresAt)}, ${new Date().toISOString()})
      returning id, user_id, label, token_hash, expires_at, last_used_at
    `
    return mapTrustedDevice(rows[0])
  }

  async validateTrustedDevice(userId: string, token: string): Promise<boolean> {
    const tokenHash = sha256(token)
    const rows = await this.sql<TrustedDeviceRow[]>`
      update trusted_devices
      set last_used_at = ${new Date().toISOString()}
      where user_id = ${userId}
        and token_hash = ${tokenHash}
        and expires_at > now()
      returning id, user_id, label, token_hash, expires_at, last_used_at
    `
    return Boolean(rows[0])
  }

  async listTrustedDevicesForUser(
    userId: string,
  ): Promise<TrustedDeviceRecord[]> {
    const rows = await this.sql<TrustedDeviceRow[]>`
      select id, user_id, label, token_hash, expires_at, last_used_at
      from trusted_devices
      where user_id = ${userId}
      order by last_used_at desc nulls last, created_at desc
    `
    return rows.map(mapTrustedDevice)
  }

  async deleteTrustedDevice(
    userId: string,
    trustedDeviceId: string,
  ): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      delete from trusted_devices
      where user_id = ${userId} and id = ${trustedDeviceId}
      returning id
    `
    return Boolean(rows[0])
  }

  async createOrReuseEnvironment(
    input: EnvironmentUpsertInput,
  ): Promise<EnvironmentRecord> {
    const now = new Date().toISOString()
    let id: string = randomUUID()
    if (input.reuseEnvironmentId) {
      const existing = await this.getEnvironment(input.reuseEnvironmentId)
      if (existing?.ownerUserId === input.ownerUserId) {
        id = input.reuseEnvironmentId
      }
    }
    const rows = await this.sql<EnvironmentRow[]>`
      insert into environments (
        id, owner_user_id, kind, machine_name, directory, branch, git_repo_url,
        max_sessions, metadata, created_at, updated_at, secret_hash
      )
      values (
        ${id}, ${input.ownerUserId}, ${input.kind}, ${input.machineName}, ${input.directory},
        ${input.branch ?? null}, ${input.gitRepoUrl ?? null}, ${input.maxSessions},
        ${JSON.stringify(input.metadata ?? {})}::jsonb, ${now}, ${now}, ${input.secretHash}
      )
      on conflict (id) do update set
        owner_user_id = excluded.owner_user_id,
        kind = excluded.kind,
        machine_name = excluded.machine_name,
        directory = excluded.directory,
        branch = excluded.branch,
        git_repo_url = excluded.git_repo_url,
        max_sessions = excluded.max_sessions,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at,
        archived_at = null,
        secret_hash = excluded.secret_hash
      returning id, owner_user_id, kind, machine_name, directory, branch, git_repo_url,
        max_sessions, metadata, created_at, updated_at, archived_at, secret_hash
    `
    return mapEnvironment(rows[0])
  }

  async getEnvironment(id: string): Promise<EnvironmentRecord | undefined> {
    const rows = await this.sql<EnvironmentRow[]>`
      select id, owner_user_id, kind, machine_name, directory, branch, git_repo_url,
        max_sessions, metadata, created_at, updated_at, archived_at, secret_hash
      from environments
      where id = ${id}
      limit 1
    `
    return rows[0] ? mapEnvironment(rows[0]) : undefined
  }

  async listEnvironmentsForUser(userId: string): Promise<EnvironmentRecord[]> {
    const rows = await this.sql<EnvironmentRow[]>`
      select id, owner_user_id, kind, machine_name, directory, branch, git_repo_url,
        max_sessions, metadata, created_at, updated_at, archived_at, secret_hash
      from environments
      where owner_user_id = ${userId}
      order by updated_at desc
    `
    return rows.map(mapEnvironment)
  }

  async validateEnvironmentSecret(
    id: string,
    token: string,
  ): Promise<EnvironmentRecord | undefined> {
    const tokenHash = sha256(token)
    const rows = await this.sql<EnvironmentRow[]>`
      select id, owner_user_id, kind, machine_name, directory, branch, git_repo_url,
        max_sessions, metadata, created_at, updated_at, archived_at, secret_hash
      from environments
      where id = ${id} and secret_hash = ${tokenHash}
      limit 1
    `
    return rows[0] ? mapEnvironment(rows[0]) : undefined
  }

  async archiveEnvironment(id: string): Promise<EnvironmentRecord | undefined> {
    const rows = await this.sql<EnvironmentRow[]>`
      update environments
      set archived_at = ${new Date().toISOString()}, updated_at = ${new Date().toISOString()}
      where id = ${id}
      returning id, owner_user_id, kind, machine_name, directory, branch, git_repo_url,
        max_sessions, metadata, created_at, updated_at, archived_at, secret_hash
    `
    return rows[0] ? mapEnvironment(rows[0]) : undefined
  }

  async createSession(
    userId: string,
    input: CreateSessionInput,
  ): Promise<SessionRecord> {
    return this.insertSession(userId, {
      title: input.title ?? null,
      environmentId: input.environment_id,
      metadata: input.metadata ?? {},
    })
  }

  async createCodeSession(
    userId: string,
    input: CreateCodeSessionInput,
  ): Promise<SessionRecord> {
    return this.insertSession(userId, {
      title: input.title ?? null,
      environmentId: input.environment_id,
      metadata: {
        ...(input.metadata ?? {}),
        seed_command: input.seed_command,
        workspace: input.workspace,
        environment_kind: input.environment_kind ?? 'raku_cloud',
      },
    })
  }

  private async insertSession(
    userId: string,
    input: {
      title: string | null
      environmentId?: string
      metadata: Record<string, unknown>
    },
  ): Promise<SessionRecord> {
    const id = randomUUID()
    const rows = await this.sql<SessionRow[]>`
      insert into sessions (
        id, owner_user_id, environment_id, status, title, metadata, worker_epoch,
        last_event_seq, created_at, updated_at
      )
      values (
        ${id}, ${userId}, ${input.environmentId ?? null}, 'queued', ${input.title},
        ${JSON.stringify(input.metadata)}::jsonb, 0, 0, ${new Date().toISOString()}, ${new Date().toISOString()}
      )
      returning id, owner_user_id, environment_id, title, status, metadata, worker_epoch,
        last_event_seq, created_at, updated_at, archived_at
    `
    return mapSession(rows[0])
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const rows = await this.sql<SessionRow[]>`
      select id, owner_user_id, environment_id, title, status, metadata, worker_epoch,
        last_event_seq, created_at, updated_at, archived_at
      from sessions
      where id = ${id}
      limit 1
    `
    return rows[0] ? mapSession(rows[0]) : undefined
  }

  async listSessionsForUser(
    userId: string,
    filters?: {
      status?: SessionStatus[]
      environmentId?: string
      recencyDays?: number
    },
  ): Promise<SessionRecord[]> {
    const rows = await this.sql<SessionRow[]>`
      select id, owner_user_id, environment_id, title, status, metadata, worker_epoch,
        last_event_seq, created_at, updated_at, archived_at
      from sessions
      where owner_user_id = ${userId}
      order by updated_at desc
    `
    const recencyCutoff =
      filters?.recencyDays !== undefined
        ? Date.now() - filters.recencyDays * 24 * 60 * 60 * 1000
        : undefined
    return rows
      .map(mapSession)
      .filter(session =>
        filters?.status?.length ? filters.status.includes(session.status) : true,
      )
      .filter(session =>
        filters?.environmentId ? session.environmentId === filters.environmentId : true,
      )
      .filter(session =>
        recencyCutoff !== undefined
          ? new Date(session.updatedAt).getTime() >= recencyCutoff
          : true,
      )
  }

  async updateSession(
    sessionId: string,
    input: UpdateSessionInput,
  ): Promise<SessionRecord | undefined> {
    const current = await this.getSession(sessionId)
    if (!current) {
      return undefined
    }
    const rows = await this.sql<SessionRow[]>`
      update sessions
      set title = ${input.title ?? current.title},
          status = ${input.status ?? current.status},
          metadata = ${JSON.stringify({
            ...current.metadata,
            ...(input.metadata ?? {}),
          })}::jsonb,
          updated_at = ${new Date().toISOString()}
      where id = ${sessionId}
      returning id, owner_user_id, environment_id, title, status, metadata, worker_epoch,
        last_event_seq, created_at, updated_at, archived_at
    `
    return rows[0] ? mapSession(rows[0]) : undefined
  }

  async archiveSession(
    sessionId: string,
  ): Promise<SessionRecord | undefined> {
    const now = new Date().toISOString()
    const rows = await this.sql<SessionRow[]>`
      update sessions
      set status = 'archived', archived_at = ${now}, updated_at = ${now}
      where id = ${sessionId}
      returning id, owner_user_id, environment_id, title, status, metadata, worker_epoch,
        last_event_seq, created_at, updated_at, archived_at
    `
    return rows[0] ? mapSession(rows[0]) : undefined
  }

  async bumpWorkerEpoch(
    sessionId: string,
  ): Promise<SessionRecord | undefined> {
    const rows = await this.sql<SessionRow[]>`
      update sessions
      set worker_epoch = worker_epoch + 1, updated_at = ${new Date().toISOString()}
      where id = ${sessionId}
      returning id, owner_user_id, environment_id, title, status, metadata, worker_epoch,
        last_event_seq, created_at, updated_at, archived_at
    `
    return rows[0] ? mapSession(rows[0]) : undefined
  }

  async appendEvent(
    sessionId: string,
    type: string,
    payload: unknown,
  ): Promise<SessionEventEnvelope> {
    const event = await this.sql.begin(async tx => {
      const sessions = await tx<SessionRow[]>`
        update sessions
        set last_event_seq = last_event_seq + 1,
            updated_at = ${new Date().toISOString()},
            status = case when status = 'queued' then 'active' else status end
        where id = ${sessionId}
        returning id, owner_user_id, environment_id, title, status, metadata, worker_epoch,
          last_event_seq, created_at, updated_at, archived_at
      `
      const session = sessions[0]
      if (!session) {
        throw new Error('Session not found')
      }
      const rows = await tx<{
        session_id: string
        seq: number
        type: string
        payload: unknown
        created_at: string
      }[]>`
        insert into session_events (id, session_id, seq, type, payload, created_at)
        values (${randomUUID()}, ${sessionId}, ${session.last_event_seq}, ${type}, ${JSON.stringify(payload)}::jsonb, ${new Date().toISOString()})
        returning session_id, seq, type, payload, created_at
      `
      return rows[0]
    })
    const envelope: SessionEventEnvelope = {
      session_id: event.session_id,
      seq: event.seq,
      type: event.type,
      payload: event.payload,
      created_at: event.created_at,
    }
    await this.publisher.publish(
      this.channelName(sessionId),
      JSON.stringify(envelope),
    )
    return envelope
  }

  async listEvents(
    sessionId: string,
    afterSeq = 0,
  ): Promise<SessionEventEnvelope[]> {
    const rows = await this.sql<{
      session_id: string
      seq: number
      type: string
      payload: unknown
      created_at: string
    }[]>`
      select session_id, seq, type, payload, created_at
      from session_events
      where session_id = ${sessionId} and seq > ${afterSeq}
      order by seq asc
    `
    return rows.map(row => ({
      session_id: row.session_id,
      seq: row.seq,
      type: row.type,
      payload: row.payload,
      created_at: row.created_at,
    }))
  }

  async subscribe(
    sessionId: string,
    listener: (event: SessionEventEnvelope) => void,
  ): Promise<() => Promise<void>> {
    const channel = this.channelName(sessionId)
    const handler = (message: string) => {
      const parsed = JSON.parse(message) as SessionEventEnvelope
      listener(parsed)
    }
    await this.subscriber.subscribe(channel, handler)
    return async () => {
      await this.subscriber.unsubscribe(channel, handler)
    }
  }

  async createWorkItem(
    environmentId: string,
    sessionId: string,
    token: string,
    tokenHash: string,
  ): Promise<WorkItemRecord> {
    const rows = await this.sql<WorkItemRow[]>`
      insert into work_items (id, environment_id, session_id, token, token_hash, status, created_at)
      values (${randomUUID()}, ${environmentId}, ${sessionId}, ${token}, ${tokenHash}, 'queued', ${new Date().toISOString()})
      returning id, environment_id, session_id, token, token_hash, status, created_at, claimed_at, heartbeat_at
    `
    return mapWorkItem(rows[0])
  }

  async pollWork(environmentId: string): Promise<WorkItemRecord | undefined> {
    const rows = await this.sql<WorkItemRow[]>`
      select id, environment_id, session_id, token, token_hash, status, created_at, claimed_at, heartbeat_at
      from work_items
      where environment_id = ${environmentId} and status = 'queued'
      order by created_at asc
      limit 1
    `
    return rows[0] ? mapWorkItem(rows[0]) : undefined
  }

  async getWorkItem(workId: string): Promise<WorkItemRecord | undefined> {
    const rows = await this.sql<WorkItemRow[]>`
      select id, environment_id, session_id, token, token_hash, status, created_at, claimed_at, heartbeat_at
      from work_items
      where id = ${workId}
      limit 1
    `
    return rows[0] ? mapWorkItem(rows[0]) : undefined
  }

  async validateWorkToken(
    workId: string,
    token: string,
  ): Promise<WorkItemRecord | undefined> {
    const tokenHash = sha256(token)
    const rows = await this.sql<WorkItemRow[]>`
      select id, environment_id, session_id, token, token_hash, status, created_at, claimed_at, heartbeat_at
      from work_items
      where id = ${workId} and token_hash = ${tokenHash}
      limit 1
    `
    return rows[0] ? mapWorkItem(rows[0]) : undefined
  }

  async claimWork(workId: string): Promise<WorkItemRecord | undefined> {
    const rows = await this.sql<WorkItemRow[]>`
      update work_items
      set status = 'claimed', claimed_at = ${new Date().toISOString()}
      where id = ${workId}
      returning id, environment_id, session_id, token, token_hash, status, created_at, claimed_at, heartbeat_at
    `
    return rows[0] ? mapWorkItem(rows[0]) : undefined
  }

  async heartbeatWork(workId: string): Promise<WorkItemRecord | undefined> {
    const rows = await this.sql<WorkItemRow[]>`
      update work_items
      set heartbeat_at = ${new Date().toISOString()}
      where id = ${workId}
      returning id, environment_id, session_id, token, token_hash, status, created_at, claimed_at, heartbeat_at
    `
    return rows[0] ? mapWorkItem(rows[0]) : undefined
  }

  async stopWork(workId: string): Promise<WorkItemRecord | undefined> {
    const rows = await this.sql<WorkItemRow[]>`
      update work_items
      set status = 'stopped'
      where id = ${workId}
      returning id, environment_id, session_id, token, token_hash, status, created_at, claimed_at, heartbeat_at
    `
    return rows[0] ? mapWorkItem(rows[0]) : undefined
  }

  async recordWorkerCredential(
    sessionId: string,
    workerEpoch: number,
    tokenJti: string,
    expiresAt: number,
  ): Promise<void> {
    await this.sql`
      insert into worker_credentials (id, session_id, worker_epoch, token_jti, expires_at, created_at)
      values (${randomUUID()}, ${sessionId}, ${workerEpoch}, ${tokenJti}, ${new Date(expiresAt)}, ${new Date().toISOString()})
    `
  }

  async getWorkerCredential(
    sessionId: string,
  ): Promise<WorkerCredentialRecord | undefined> {
    const rows = await this.sql<WorkerCredentialRow[]>`
      select session_id, worker_epoch, token_jti, expires_at, connected_at
      from worker_credentials
      where session_id = ${sessionId}
      order by created_at desc
      limit 1
    `
    return rows[0] ? mapWorkerCredential(rows[0]) : undefined
  }

  async connectWorker(
    sessionId: string,
    workerEpoch: number,
  ): Promise<WorkerCredentialRecord | undefined> {
    const rows = await this.sql<WorkerCredentialRow[]>`
      update worker_credentials
      set connected_at = ${new Date().toISOString()}
      where session_id = ${sessionId} and worker_epoch = ${workerEpoch}
      returning session_id, worker_epoch, token_jti, expires_at, connected_at
    `
    return rows[0] ? mapWorkerCredential(rows[0]) : undefined
  }

  async close(): Promise<void> {
    await this.subscriber.quit()
    await this.publisher.quit()
    await this.sql.end()
  }

  private channelName(sessionId: string): string {
    return `${this.channelPrefix}:session:${sessionId}`
  }
}
