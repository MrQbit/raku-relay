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

type RefreshTokenRecord = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: number
  revokedAt?: number
  replacedByTokenId?: string
}

type TrustedDeviceRecord = {
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

type WorkerCredentialRecord = {
  sessionId: string
  workerEpoch: number
  tokenJti: string
  expiresAt: number
  connectedAt?: number
}

export class MemoryRelayStore {
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

  upsertUser(identity: AzureIdentity): UserRecord {
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

  getUser(userId: string): UserRecord | undefined {
    return this.users.get(userId)
  }

  createRefreshToken(userId: string, tokenHash: string, expiresAt: number) {
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt,
    }
    this.refreshTokens.set(tokenHash, record)
    return record
  }

  rotateRefreshToken(oldTokenHash: string, newTokenHash: string, expiresAt: number) {
    const current = this.refreshTokens.get(oldTokenHash)
    if (!current || current.revokedAt || current.expiresAt < Date.now()) {
      return null
    }
    current.revokedAt = Date.now()
    const next = this.createRefreshToken(current.userId, newTokenHash, expiresAt)
    current.replacedByTokenId = next.id
    return { current, next }
  }

  getRefreshToken(tokenHash: string): RefreshTokenRecord | undefined {
    return this.refreshTokens.get(tokenHash)
  }

  revokeRefreshToken(tokenHash: string): void {
    const token = this.refreshTokens.get(tokenHash)
    if (token) {
      token.revokedAt = Date.now()
    }
  }

  createTrustedDevice(
    userId: string,
    label: string,
    tokenHash: string,
    expiresAt: number,
  ): TrustedDeviceRecord {
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

  validateTrustedDevice(userId: string, token: string): boolean {
    const record = this.trustedDevices.get(sha256(token))
    if (!record || record.userId !== userId || record.expiresAt < Date.now()) {
      return false
    }
    record.lastUsedAt = Date.now()
    return true
  }

  createOrReuseEnvironment(input: {
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
  }): EnvironmentRecord {
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

  getEnvironment(id: string): EnvironmentRecord | undefined {
    return this.environments.get(id)
  }

  validateEnvironmentSecret(id: string, token: string): EnvironmentRecord | undefined {
    const environment = this.environments.get(id)
    if (!environment) {
      return undefined
    }
    return environment.secretHash === sha256(token) ? environment : undefined
  }

  archiveEnvironment(id: string) {
    const environment = this.environments.get(id)
    if (!environment) {
      return undefined
    }
    environment.archivedAt = new Date().toISOString()
    environment.updatedAt = environment.archivedAt
    return environment
  }

  createSession(userId: string, input: CreateSessionInput): SessionRecord {
    return this.insertSession({
      ownerUserId: userId,
      environmentId: input.environment_id,
      title: input.title ?? null,
      metadata: input.metadata ?? {},
    })
  }

  createCodeSession(userId: string, input: CreateCodeSessionInput): SessionRecord {
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

  private insertSession(input: {
    ownerUserId: string
    environmentId?: string
    title: string | null
    metadata: Record<string, unknown>
  }): SessionRecord {
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

  getSession(id: string): SessionRecord | undefined {
    return this.sessions.get(id)
  }

  updateSession(sessionId: string, input: UpdateSessionInput): SessionRecord | undefined {
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

  archiveSession(sessionId: string): SessionRecord | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return undefined
    }
    session.status = 'archived'
    session.archivedAt = new Date().toISOString()
    session.updatedAt = session.archivedAt
    return session
  }

  appendEvent(
    sessionId: string,
    type: string,
    payload: unknown,
  ): SessionEventEnvelope {
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

  listEvents(sessionId: string, afterSeq = 0): SessionEventEnvelope[] {
    const events = this.sessionEvents.get(sessionId) ?? []
    return events.filter(event => event.seq > afterSeq)
  }

  subscribe(
    sessionId: string,
    listener: (event: SessionEventEnvelope) => void,
  ): () => void {
    this.emitter.on(`session:${sessionId}`, listener)
    return () => {
      this.emitter.off(`session:${sessionId}`, listener)
    }
  }

  createWorkItem(
    environmentId: string,
    sessionId: string,
    token: string,
    tokenHash: string,
  ) {
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

  pollWork(environmentId: string): WorkItemRecord | undefined {
    return [...this.workItems.values()].find(
      work => work.environmentId === environmentId && work.status === 'queued',
    )
  }

  getWorkItem(workId: string): WorkItemRecord | undefined {
    return this.workItems.get(workId)
  }

  validateWorkToken(workId: string, token: string): WorkItemRecord | undefined {
    const work = this.workItems.get(workId)
    if (!work) {
      return undefined
    }
    return work.tokenHash === sha256(token) ? work : undefined
  }

  claimWork(workId: string): WorkItemRecord | undefined {
    const work = this.workItems.get(workId)
    if (!work) {
      return undefined
    }
    work.status = 'claimed'
    work.claimedAt = new Date().toISOString()
    return work
  }

  heartbeatWork(workId: string): WorkItemRecord | undefined {
    const work = this.workItems.get(workId)
    if (!work) {
      return undefined
    }
    work.heartbeatAt = new Date().toISOString()
    return work
  }

  stopWork(workId: string): WorkItemRecord | undefined {
    const work = this.workItems.get(workId)
    if (!work) {
      return undefined
    }
    work.status = 'stopped'
    return work
  }

  recordWorkerCredential(
    sessionId: string,
    workerEpoch: number,
    tokenJti: string,
    expiresAt: number,
  ) {
    this.workerCredentials.set(sessionId, {
      sessionId,
      workerEpoch,
      tokenJti,
      expiresAt,
    })
  }

  getWorkerCredential(sessionId: string) {
    return this.workerCredentials.get(sessionId)
  }

  connectWorker(sessionId: string, workerEpoch: number) {
    const credential = this.workerCredentials.get(sessionId)
    if (!credential || credential.workerEpoch !== workerEpoch) {
      return undefined
    }
    credential.connectedAt = Date.now()
    return credential
  }
}

export function createOpaqueSecret(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}

export async function issueBridgeCredentials(
  store: MemoryRelayStore,
  tokenService: RelayTokenService,
  sessionId: string,
  user: UserRecord,
) {
  const session = store.getSession(sessionId)
  if (!session) {
    throw new Error('Session not found')
  }
  session.workerEpoch += 1
  session.updatedAt = new Date().toISOString()
  const worker = await tokenService.issueWorkerToken({
    sub: user.id,
    tenant_id: user.tenantId,
    session_id: session.id,
    worker_epoch: session.workerEpoch,
    role: 'worker',
  })
  store.recordWorkerCredential(
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
