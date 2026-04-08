import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { AzureIdentity, RelayTokenService } from '@raku-relay/auth'
import type {
  CreateCodeSessionInput,
  CreateSessionInput,
  EnvironmentKind,
  SessionEventEnvelope,
  SessionStatus,
  UpdateSessionInput,
} from '@raku-relay/contracts'
import { sha256 } from '@raku-relay/auth'

export type UserRecord = {
  id: string
  tenantId: string
  email: string | null
  displayName: string | null
  subject: string
  createdAt: string
  updatedAt: string
}

export type EnvironmentRecord = {
  id: string
  ownerUserId: string
  kind: EnvironmentKind
  machineName: string
  directory: string
  branch?: string
  gitRepoUrl?: string
  maxSessions: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  archivedAt?: string
  secretHash: string
}

export type SessionRecord = {
  id: string
  ownerUserId: string
  environmentId?: string
  title: string | null
  status: SessionStatus
  metadata: Record<string, unknown>
  workerEpoch: number
  lastEventSeq: number
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export type RefreshTokenRecord = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: number
  revokedAt?: number
  replacedByTokenId?: string
}

export type TrustedDeviceRecord = {
  id: string
  userId: string
  label: string
  tokenHash: string
  expiresAt: number
  lastUsedAt?: number
}

export type WorkItemRecord = {
  id: string
  environmentId: string
  sessionId: string
  token: string
  tokenHash: string
  status: 'queued' | 'claimed' | 'stopped' | 'completed'
  createdAt: string
  claimedAt?: string
  heartbeatAt?: string
}

export type WorkerCredentialRecord = {
  sessionId: string
  workerEpoch: number
  tokenJti: string
  expiresAt: number
  connectedAt?: number
}

export type EnvironmentUpsertInput = {
  ownerUserId: string
  kind: EnvironmentKind
  machineName: string
  directory: string
  branch?: string
  gitRepoUrl?: string
  maxSessions: number
  metadata?: Record<string, unknown>
  reuseEnvironmentId?: string
  secretHash: string
}

export interface RelayStore {
  upsertUser(identity: AzureIdentity): Promise<UserRecord>
  getUser(userId: string): Promise<UserRecord | undefined>
  createRefreshToken(
    userId: string,
    tokenHash: string,
    expiresAt: number,
  ): Promise<RefreshTokenRecord>
  rotateRefreshToken(
    oldTokenHash: string,
    newTokenHash: string,
    expiresAt: number,
  ): Promise<{ current: RefreshTokenRecord; next: RefreshTokenRecord } | null>
  getRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | undefined>
  revokeRefreshToken(tokenHash: string): Promise<void>
  createTrustedDevice(
    userId: string,
    label: string,
    tokenHash: string,
    expiresAt: number,
  ): Promise<TrustedDeviceRecord>
  validateTrustedDevice(userId: string, token: string): Promise<boolean>
  createOrReuseEnvironment(
    input: EnvironmentUpsertInput,
  ): Promise<EnvironmentRecord>
  getEnvironment(id: string): Promise<EnvironmentRecord | undefined>
  validateEnvironmentSecret(
    id: string,
    token: string,
  ): Promise<EnvironmentRecord | undefined>
  archiveEnvironment(id: string): Promise<EnvironmentRecord | undefined>
  createSession(
    userId: string,
    input: CreateSessionInput,
  ): Promise<SessionRecord>
  createCodeSession(
    userId: string,
    input: CreateCodeSessionInput,
  ): Promise<SessionRecord>
  getSession(id: string): Promise<SessionRecord | undefined>
  updateSession(
    sessionId: string,
    input: UpdateSessionInput,
  ): Promise<SessionRecord | undefined>
  archiveSession(sessionId: string): Promise<SessionRecord | undefined>
  bumpWorkerEpoch(sessionId: string): Promise<SessionRecord | undefined>
  appendEvent(
    sessionId: string,
    type: string,
    payload: unknown,
  ): Promise<SessionEventEnvelope>
  listEvents(
    sessionId: string,
    afterSeq?: number,
  ): Promise<SessionEventEnvelope[]>
  subscribe(
    sessionId: string,
    listener: (event: SessionEventEnvelope) => void,
  ): Promise<() => void | Promise<void>>
  createWorkItem(
    environmentId: string,
    sessionId: string,
    token: string,
    tokenHash: string,
  ): Promise<WorkItemRecord>
  pollWork(environmentId: string): Promise<WorkItemRecord | undefined>
  getWorkItem(workId: string): Promise<WorkItemRecord | undefined>
  validateWorkToken(
    workId: string,
    token: string,
  ): Promise<WorkItemRecord | undefined>
  claimWork(workId: string): Promise<WorkItemRecord | undefined>
  heartbeatWork(workId: string): Promise<WorkItemRecord | undefined>
  stopWork(workId: string): Promise<WorkItemRecord | undefined>
  recordWorkerCredential(
    sessionId: string,
    workerEpoch: number,
    tokenJti: string,
    expiresAt: number,
  ): Promise<void>
  getWorkerCredential(
    sessionId: string,
  ): Promise<WorkerCredentialRecord | undefined>
  connectWorker(
    sessionId: string,
    workerEpoch: number,
  ): Promise<WorkerCredentialRecord | undefined>
  close(): Promise<void>
}

export class MemoryRelayStore implements RelayStore {
  private users = new Map<string, UserRecord>()
  private usersBySubject = new Map<string, string>()
  private refreshTokens = new Map<string, RefreshTokenRecord>()
  private trustedDevices = new Map<string, TrustedDeviceRecord>()
  private environments = new Map<string, EnvironmentRecord>()
  private sessions = new Map<string, SessionRecord>()
  private sessionEvents = new Map<string, SessionEventEnvelope[]>()
  private workItems = new Map<string, WorkItemRecord>()
  private workerCredentials = new Map<string, WorkerCredentialRecord>()
  private emitter = new EventEmitter()

  async upsertUser(identity: AzureIdentity): Promise<UserRecord> {
    const now = new Date().toISOString()
    const lookupKey = `${identity.tenantId}:${identity.subject}`
    const existingId = this.usersBySubject.get(lookupKey)
    if (existingId) {
      const existing = this.users.get(existingId)!
      const updated: UserRecord = {
        ...existing,
        tenantId: identity.tenantId,
        email: identity.email,
        displayName: identity.displayName,
        updatedAt: now,
      }
      this.users.set(existingId, updated)
      return updated
    }
    const user: UserRecord = {
      id: randomUUID(),
      tenantId: identity.tenantId,
      email: identity.email,
      displayName: identity.displayName,
      subject: identity.subject,
      createdAt: now,
      updatedAt: now,
    }
    this.users.set(user.id, user)
    this.usersBySubject.set(lookupKey, user.id)
    return user
  }

  async getUser(userId: string): Promise<UserRecord | undefined> {
    return this.users.get(userId)
  }

  async createRefreshToken(
    userId: string,
    tokenHash: string,
    expiresAt: number,
  ): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
    }
    this.refreshTokens.set(tokenHash, record)
    return record
  }

  async rotateRefreshToken(
    oldTokenHash: string,
    newTokenHash: string,
    expiresAt: number,
  ): Promise<{ current: RefreshTokenRecord; next: RefreshTokenRecord } | null> {
    const current = this.refreshTokens.get(oldTokenHash)
    if (!current || current.revokedAt || current.expiresAt < Date.now()) {
      return null
    }
    current.revokedAt = Date.now()
    const next = await this.createRefreshToken(current.userId, newTokenHash, expiresAt)
    current.replacedByTokenId = next.id
    return { current, next }
  }

  async getRefreshToken(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | undefined> {
    return this.refreshTokens.get(tokenHash)
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    const token = this.refreshTokens.get(tokenHash)
    if (token) {
      token.revokedAt = Date.now()
    }
  }

  async createTrustedDevice(
    userId: string,
    label: string,
    tokenHash: string,
    expiresAt: number,
  ): Promise<TrustedDeviceRecord> {
    const record: TrustedDeviceRecord = {
      id: randomUUID(),
      userId,
      label,
      tokenHash,
      expiresAt,
    }
    this.trustedDevices.set(tokenHash, record)
    return record
  }

  async validateTrustedDevice(userId: string, token: string): Promise<boolean> {
    const record = this.trustedDevices.get(sha256(token))
    if (!record || record.userId !== userId || record.expiresAt < Date.now()) {
      return false
    }
    record.lastUsedAt = Date.now()
    return true
  }

  async createOrReuseEnvironment(
    input: EnvironmentUpsertInput,
  ): Promise<EnvironmentRecord> {
    const now = new Date().toISOString()
    if (input.reuseEnvironmentId) {
      const existing = this.environments.get(input.reuseEnvironmentId)
      if (existing && existing.ownerUserId === input.ownerUserId) {
        const updated = {
          ...existing,
          machineName: input.machineName,
          directory: input.directory,
          branch: input.branch,
          gitRepoUrl: input.gitRepoUrl,
          maxSessions: input.maxSessions,
          metadata: input.metadata ?? {},
          secretHash: input.secretHash,
          updatedAt: now,
        }
        this.environments.set(existing.id, updated)
        return updated
      }
    }
    const environment: EnvironmentRecord = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      kind: input.kind,
      machineName: input.machineName,
      directory: input.directory,
      branch: input.branch,
      gitRepoUrl: input.gitRepoUrl,
      maxSessions: input.maxSessions,
      metadata: input.metadata ?? {},
      secretHash: input.secretHash,
      createdAt: now,
      updatedAt: now,
    }
    this.environments.set(environment.id, environment)
    return environment
  }

  async getEnvironment(id: string): Promise<EnvironmentRecord | undefined> {
    return this.environments.get(id)
  }

  async validateEnvironmentSecret(
    id: string,
    token: string,
  ): Promise<EnvironmentRecord | undefined> {
    const environment = this.environments.get(id)
    if (!environment) {
      return undefined
    }
    return environment.secretHash === sha256(token) ? environment : undefined
  }

  async archiveEnvironment(id: string): Promise<EnvironmentRecord | undefined> {
    const environment = this.environments.get(id)
    if (!environment) {
      return undefined
    }
    environment.archivedAt = new Date().toISOString()
    environment.updatedAt = environment.archivedAt
    return environment
  }

  async createSession(
    userId: string,
    input: CreateSessionInput,
  ): Promise<SessionRecord> {
    return this.insertSession({
      ownerUserId: userId,
      environmentId: input.environment_id,
      title: input.title ?? null,
      metadata: input.metadata ?? {},
    })
  }

  async createCodeSession(
    userId: string,
    input: CreateCodeSessionInput,
  ): Promise<SessionRecord> {
    return this.insertSession({
      ownerUserId: userId,
      environmentId: input.environment_id,
      title: input.title ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        seed_command: input.seed_command,
        workspace: input.workspace,
        environment_kind: input.environment_kind ?? 'raku_cloud',
      },
    })
  }

  private async insertSession(input: {
    ownerUserId: string
    environmentId?: string
    title: string | null
    metadata: Record<string, unknown>
  }): Promise<SessionRecord> {
    const now = new Date().toISOString()
    const session: SessionRecord = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      environmentId: input.environmentId,
      title: input.title,
      metadata: input.metadata,
      status: 'queued',
      workerEpoch: 0,
      lastEventSeq: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(session.id, session)
    this.sessionEvents.set(session.id, [])
    return session
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    return this.sessions.get(id)
  }

  async updateSession(
    sessionId: string,
    input: UpdateSessionInput,
  ): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return undefined
    }
    if (input.title !== undefined) {
      session.title = input.title
    }
    if (input.status !== undefined) {
      session.status = input.status
    }
    if (input.metadata !== undefined) {
      session.metadata = {
        ...session.metadata,
        ...input.metadata,
      }
    }
    session.updatedAt = new Date().toISOString()
    return session
  }

  async archiveSession(
    sessionId: string,
  ): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return undefined
    }
    session.status = 'archived'
    session.archivedAt = new Date().toISOString()
    session.updatedAt = session.archivedAt
    return session
  }

  async bumpWorkerEpoch(
    sessionId: string,
  ): Promise<SessionRecord | undefined> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return undefined
    }
    session.workerEpoch += 1
    session.updatedAt = new Date().toISOString()
    return session
  }

  async appendEvent(
    sessionId: string,
    type: string,
    payload: unknown,
  ): Promise<SessionEventEnvelope> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Session not found')
    }
    const seq = session.lastEventSeq + 1
    session.lastEventSeq = seq
    session.updatedAt = new Date().toISOString()
    if (session.status === 'queued') {
      session.status = 'active'
    }
    const event: SessionEventEnvelope = {
      session_id: sessionId,
      seq,
      type,
      payload,
      created_at: new Date().toISOString(),
    }
    const events = this.sessionEvents.get(sessionId) ?? []
    events.push(event)
    this.sessionEvents.set(sessionId, events)
    this.emitter.emit(`session:${sessionId}`, event)
    return event
  }

  async listEvents(
    sessionId: string,
    afterSeq = 0,
  ): Promise<SessionEventEnvelope[]> {
    const events = this.sessionEvents.get(sessionId) ?? []
    return events.filter(event => event.seq > afterSeq)
  }

  async subscribe(
    sessionId: string,
    listener: (event: SessionEventEnvelope) => void,
  ): Promise<() => void> {
    this.emitter.on(`session:${sessionId}`, listener)
    return () => {
      this.emitter.off(`session:${sessionId}`, listener)
    }
  }

  async createWorkItem(
    environmentId: string,
    sessionId: string,
    token: string,
    tokenHash: string,
  ): Promise<WorkItemRecord> {
    const item: WorkItemRecord = {
      id: randomUUID(),
      environmentId,
      sessionId,
      token,
      tokenHash,
      status: 'queued',
      createdAt: new Date().toISOString(),
    }
    this.workItems.set(item.id, item)
    return item
  }

  async pollWork(environmentId: string): Promise<WorkItemRecord | undefined> {
    return [...this.workItems.values()].find(
      work => work.environmentId === environmentId && work.status === 'queued',
    )
  }

  async getWorkItem(workId: string): Promise<WorkItemRecord | undefined> {
    return this.workItems.get(workId)
  }

  async validateWorkToken(
    workId: string,
    token: string,
  ): Promise<WorkItemRecord | undefined> {
    const work = this.workItems.get(workId)
    if (!work) {
      return undefined
    }
    return work.tokenHash === sha256(token) ? work : undefined
  }

  async claimWork(workId: string): Promise<WorkItemRecord | undefined> {
    const work = this.workItems.get(workId)
    if (!work) {
      return undefined
    }
    work.status = 'claimed'
    work.claimedAt = new Date().toISOString()
    return work
  }

  async heartbeatWork(workId: string): Promise<WorkItemRecord | undefined> {
    const work = this.workItems.get(workId)
    if (!work) {
      return undefined
    }
    work.heartbeatAt = new Date().toISOString()
    return work
  }

  async stopWork(workId: string): Promise<WorkItemRecord | undefined> {
    const work = this.workItems.get(workId)
    if (!work) {
      return undefined
    }
    work.status = 'stopped'
    return work
  }

  async recordWorkerCredential(
    sessionId: string,
    workerEpoch: number,
    tokenJti: string,
    expiresAt: number,
  ): Promise<void> {
    this.workerCredentials.set(sessionId, {
      sessionId,
      workerEpoch,
      tokenJti,
      expiresAt,
    })
  }

  async getWorkerCredential(
    sessionId: string,
  ): Promise<WorkerCredentialRecord | undefined> {
    return this.workerCredentials.get(sessionId)
  }

  async connectWorker(
    sessionId: string,
    workerEpoch: number,
  ): Promise<WorkerCredentialRecord | undefined> {
    const credential = this.workerCredentials.get(sessionId)
    if (!credential || credential.workerEpoch !== workerEpoch) {
      return undefined
    }
    credential.connectedAt = Date.now()
    return credential
  }

  async close(): Promise<void> {}
}

export function createOpaqueSecret(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}

export async function issueBridgeCredentials(
  store: RelayStore,
  tokenService: RelayTokenService,
  sessionId: string,
  user: UserRecord,
) {
  const session = await store.bumpWorkerEpoch(sessionId)
  if (!session) {
    throw new Error('Session not found')
  }
  const worker = await tokenService.issueWorkerToken({
    sub: user.id,
    tenant_id: user.tenantId,
    session_id: session.id,
    worker_epoch: session.workerEpoch,
    role: 'worker',
  })
  await store.recordWorkerCredential(
    session.id,
    session.workerEpoch,
    worker.jti,
    Date.now() + worker.expiresIn * 1000,
  )
  return {
    session,
    worker,
  }
}
