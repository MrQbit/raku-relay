import Fastify, { type FastifyRequest } from 'fastify'
import sensible from '@fastify/sensible'
import websocket from '@fastify/websocket'
import { randomUUID } from 'crypto'
import { loadConfig, type RelayConfig } from '@raku-relay/config'
import {
  appendSessionEventsSchema,
  authExchangeSchema,
  createCodeSessionSchema,
  createSessionSchema,
  refreshTokenSchema,
  registerEnvironmentSchema,
  trustedDeviceRequestSchema,
  updateSessionSchema,
  type SessionEventEnvelope,
} from '@raku-relay/contracts'
import {
  AzureTokenValidator,
  RelayTokenService,
  sha256,
} from '@raku-relay/auth'
import { audit, logger } from '@raku-relay/logging'
import {
  MemoryRelayStore,
  createOpaqueSecret,
  issueBridgeCredentials,
  type SessionRecord,
  type UserRecord,
} from './lib/store.js'
import { RunnerLauncher } from './services/launcher.js'

type BuildServerOptions = {
  config?: RelayConfig
  store?: MemoryRelayStore
  azureValidator?: AzureTokenValidator
  tokenService?: RelayTokenService
}

function readBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return undefined
  }
  return header.slice('Bearer '.length)
}

export async function buildServer(options: BuildServerOptions = {}) {
  const config = options.config ?? loadConfig()
  const store = options.store ?? new MemoryRelayStore()
  const privateJwk = JSON.parse(config.privateJwkJson)
  const publicJwks = JSON.parse(config.publicJwksJson)
  const tokenService =
    options.tokenService ??
    new RelayTokenService({
      issuer: config.jwtIssuer,
      privateJwk,
      accessTokenTtlSeconds: config.ttl.accessTokenSeconds,
      refreshTokenTtlSeconds: config.ttl.refreshTokenSeconds,
      workerTokenTtlSeconds: config.ttl.workerTokenSeconds,
      trustedDeviceTtlSeconds: config.ttl.trustedDeviceSeconds,
    })
  const azureJwks = config.azure.jwksJson
    ? JSON.parse(config.azure.jwksJson)
    : publicJwks
  const azureValidator =
    options.azureValidator ??
    new AzureTokenValidator({
      issuer: config.azure.issuer,
      audience: config.azure.audience,
      clientId: config.azure.clientId,
      tenantId: config.azure.tenantId,
      allowedTenants: config.azure.allowedTenants,
      verificationKey: azureJwks.keys[0],
    })
  const launcher = new RunnerLauncher(config)

  const app = Fastify({ logger: false })
  await app.register(sensible)
  await app.register(websocket)

  async function requireUser(
    request: FastifyRequest,
    options?: { skipTrustedDevice?: boolean },
  ): Promise<UserRecord> {
    const token = readBearerToken(request)
    if (!token) {
      throw app.httpErrors.unauthorized('Missing bearer token')
    }
    try {
      const payload = await tokenService.verifyRelayAccessToken(token)
      const user = store.getUser(String(payload.sub))
      if (!user) {
        throw new Error('User not found')
      }
      if (
        !options?.skipTrustedDevice &&
        config.requireTrustedDevice &&
        !store.validateTrustedDevice(
          user.id,
          String(request.headers['x-trusted-device-token'] ?? ''),
        )
      ) {
        throw app.httpErrors.unauthorized('Trusted device token required')
      }
      return user
    } catch {
      throw app.httpErrors.unauthorized('Invalid relay access token')
    }
  }

  function requireEnvironmentSecret(request: FastifyRequest) {
    const token = readBearerToken(request)
    const environmentId = String((request.params as Record<string, string>).id)
    if (!token) {
      throw app.httpErrors.unauthorized('Missing bridge secret')
    }
    const environment = store.validateEnvironmentSecret(environmentId, token)
    if (!environment) {
      throw app.httpErrors.unauthorized('Invalid bridge secret')
    }
    return environment
  }

  async function requireWorkerOrUserForSession(
    request: FastifyRequest,
    sessionId: string,
  ) {
    const token = readBearerToken(request)
    if (!token) {
      throw app.httpErrors.unauthorized('Missing bearer token')
    }
    try {
      const payload = await tokenService.verifyRelayAccessToken(token)
      const user = store.getUser(String(payload.sub))
      if (!user) {
        throw new Error('User not found')
      }
      return { kind: 'user' as const, user }
    } catch {
      const payload = await tokenService.verifyWorkerToken(token).catch(() => null)
      if (!payload) {
        throw app.httpErrors.unauthorized('Invalid session token')
      }
      if (
        String(payload.session_id) !== sessionId ||
        String(payload.role) !== 'worker'
      ) {
        throw app.httpErrors.unauthorized('Worker token scope mismatch')
      }
      const credential = store.getWorkerCredential(sessionId)
      if (
        !credential ||
        credential.workerEpoch !== Number(payload.worker_epoch) ||
        credential.expiresAt < Date.now()
      ) {
        throw app.httpErrors.unauthorized('Worker token expired or stale')
      }
      const user = store.getUser(String(payload.sub))
      if (!user) {
        throw app.httpErrors.unauthorized('Worker user not found')
      }
      return { kind: 'worker' as const, user, payload }
    }
  }

  app.get('/healthz', async () => ({ ok: true }))
  app.get('/readyz', async () => ({ ok: true, storage_backend: config.storageBackend }))
  app.get('/.well-known/jwks.json', async () => publicJwks)

  app.post('/v1/auth/azure/exchange', async request => {
    const input = authExchangeSchema.parse(request.body)
    const identity = await azureValidator.validateIdToken(input.id_token)
    const user = store.upsertUser(identity)
    const access = await tokenService.issueAccessToken({
      sub: user.id,
      tenant_id: user.tenantId,
      scopes: ['relay:read', 'relay:write'],
      session_capabilities: ['sessions', 'bridge', 'runner'],
    })
    const refresh = tokenService.issueOpaqueRefreshToken()
    store.createRefreshToken(
      user.id,
      refresh.hash,
      Date.now() + refresh.expiresIn * 1000,
    )
    audit('auth.exchange', { userId: user.id, tenantId: user.tenantId })
    return {
      access_token: access.token,
      refresh_token: refresh.token,
      expires_in: access.expiresIn,
      token_type: 'Bearer',
      user: {
        id: user.id,
        tenant_id: user.tenantId,
        email: user.email,
        display_name: user.displayName,
      },
    }
  })

  app.post('/v1/auth/refresh', async request => {
    const input = refreshTokenSchema.parse(request.body)
    const current = store.getRefreshToken(sha256(input.refresh_token))
    if (!current || current.revokedAt || current.expiresAt < Date.now()) {
      throw app.httpErrors.unauthorized('Refresh token is invalid')
    }
    const user = store.getUser(current.userId)
    if (!user) {
      throw app.httpErrors.unauthorized('User not found for refresh token')
    }
    const nextRefresh = tokenService.issueOpaqueRefreshToken()
    store.rotateRefreshToken(
      sha256(input.refresh_token),
      nextRefresh.hash,
      Date.now() + nextRefresh.expiresIn * 1000,
    )
    const access = await tokenService.issueAccessToken({
      sub: user.id,
      tenant_id: user.tenantId,
      scopes: ['relay:read', 'relay:write'],
      session_capabilities: ['sessions', 'bridge', 'runner'],
    })
    audit('auth.refresh', { userId: user.id })
    return {
      access_token: access.token,
      refresh_token: nextRefresh.token,
      expires_in: access.expiresIn,
      token_type: 'Bearer',
      user: {
        id: user.id,
        tenant_id: user.tenantId,
        email: user.email,
        display_name: user.displayName,
      },
    }
  })

  app.post('/v1/auth/logout', async request => {
    const input = refreshTokenSchema.parse(request.body)
    store.revokeRefreshToken(sha256(input.refresh_token))
    return { ok: true }
  })

  app.post('/v1/auth/trusted-devices', async request => {
    const user = await requireUser(request, { skipTrustedDevice: true })
    const input = trustedDeviceRequestSchema.parse(request.body)
    const trusted = tokenService.issueTrustedDeviceToken()
    store.createTrustedDevice(
      user.id,
      input.label,
      trusted.hash,
      Date.now() + trusted.expiresIn * 1000,
    )
    audit('trusted_device.create', { userId: user.id, label: input.label })
    return {
      trusted_device_token: trusted.token,
      expires_in: trusted.expiresIn,
      label: input.label,
    }
  })

  app.post('/v1/environments/bridge', async request => {
    const user = await requireUser(request)
    const input = registerEnvironmentSchema.parse(request.body)
    const secret = createOpaqueSecret()
    const environment = store.createOrReuseEnvironment({
      ownerUserId: user.id,
      kind: 'local_bridge',
      machineName: input.machine_name,
      directory: input.directory,
      branch: input.branch,
      gitRepoUrl: input.git_repo_url,
      maxSessions: input.max_sessions ?? 1,
      metadata: input.metadata,
      reuseEnvironmentId: input.environment_id,
      secretHash: sha256(secret),
    })
    audit('environment.register', {
      userId: user.id,
      environmentId: environment.id,
    })
    return {
      environment_id: environment.id,
      environment_secret: secret,
      kind: environment.kind,
    }
  })

  app.delete('/v1/environments/bridge/:id', async request => {
    const user = await requireUser(request)
    const id = String((request.params as Record<string, string>).id)
    const environment = store.getEnvironment(id)
    if (!environment || environment.ownerUserId !== user.id) {
      throw app.httpErrors.notFound('Environment not found')
    }
    store.archiveEnvironment(id)
    audit('environment.archive', { userId: user.id, environmentId: id })
    return { ok: true }
  })

  app.post('/v1/environments/:id/bridge/reconnect', async request => {
    const user = await requireUser(request)
    const id = String((request.params as Record<string, string>).id)
    const environment = store.getEnvironment(id)
    if (!environment || environment.ownerUserId !== user.id) {
      throw app.httpErrors.notFound('Environment not found')
    }
    const secret = createOpaqueSecret()
    store.createOrReuseEnvironment({
      ownerUserId: user.id,
      kind: environment.kind,
      machineName: environment.machineName,
      directory: environment.directory,
      branch: environment.branch,
      gitRepoUrl: environment.gitRepoUrl,
      maxSessions: environment.maxSessions,
      metadata: environment.metadata,
      reuseEnvironmentId: environment.id,
      secretHash: sha256(secret),
    })
    return {
      environment_id: environment.id,
      environment_secret: secret,
      kind: environment.kind,
    }
  })

  app.get('/v1/environments/:id/work/poll', async request => {
    const environment = requireEnvironmentSecret(request)
    const work = store.pollWork(environment.id)
    if (!work) {
      return null
    }
    const session = store.getSession(work.sessionId)
    if (!session) {
      throw app.httpErrors.notFound('Session not found for work item')
    }
    return {
      id: work.id,
      token: work.token,
      status: work.status,
      created_at: work.createdAt,
      data: {
        type: 'session_start',
        id: session.id,
        session_id: session.id,
        title: session.title,
        metadata: session.metadata,
      },
    }
  })

  async function requireWorkToken(
    request: FastifyRequest,
  ): Promise<{ workId: string; work: ReturnType<MemoryRelayStore['getWorkItem']> }> {
    const token = readBearerToken(request)
    const { workId } = request.params as { workId: string }
    if (!token) {
      throw app.httpErrors.unauthorized('Missing work token')
    }
    const work = store.validateWorkToken(workId, token)
    if (!work) {
      throw app.httpErrors.unauthorized('Invalid work token')
    }
    return { workId, work }
  }

  app.post('/v1/environments/:id/work/:workId/ack', async request => {
    const { workId, work } = await requireWorkToken(request)
    store.claimWork(workId)
    return { ok: true, session_id: work?.sessionId }
  })

  app.post('/v1/environments/:id/work/:workId/stop', async request => {
    const { workId } = await requireWorkToken(request)
    store.stopWork(workId)
    return { ok: true }
  })

  app.post('/v1/environments/:id/work/:workId/heartbeat', async request => {
    const { workId } = await requireWorkToken(request)
    store.heartbeatWork(workId)
    return { ok: true }
  })

  app.post('/v1/sessions', async request => {
    const user = await requireUser(request)
    const input = createSessionSchema.parse(request.body)
    const session = store.createSession(user.id, input)
    audit('session.create', { userId: user.id, sessionId: session.id })
    return { session }
  })

  app.get('/v1/sessions/:id', async request => {
    const user = await requireUser(request)
    const id = String((request.params as Record<string, string>).id)
    const session = store.getSession(id)
    if (!session || session.ownerUserId !== user.id) {
      throw app.httpErrors.notFound('Session not found')
    }
    return {
      session,
      events: store.listEvents(id),
    }
  })

  app.patch('/v1/sessions/:id', async request => {
    const user = await requireUser(request)
    const id = String((request.params as Record<string, string>).id)
    const session = store.getSession(id)
    if (!session || session.ownerUserId !== user.id) {
      throw app.httpErrors.notFound('Session not found')
    }
    const updated = store.updateSession(id, updateSessionSchema.parse(request.body))
    return { session: updated }
  })

  app.post('/v1/sessions/:id/archive', async request => {
    const id = String((request.params as Record<string, string>).id)
    const auth = await requireWorkerOrUserForSession(request, id)
    const session = store.getSession(id)
    if (!session) {
      throw app.httpErrors.notFound('Session not found')
    }
    if (auth.kind === 'user' && session.ownerUserId !== auth.user.id) {
      throw app.httpErrors.forbidden('Session ownership mismatch')
    }
    const archived = store.archiveSession(id)
    audit('session.archive', { actor: auth.kind, sessionId: id })
    return { session: archived }
  })

  app.post('/v1/sessions/:id/events', async request => {
    const id = String((request.params as Record<string, string>).id)
    const auth = await requireWorkerOrUserForSession(request, id)
    const input = appendSessionEventsSchema.parse(request.body)
    const session = store.getSession(id)
    if (!session) {
      throw app.httpErrors.notFound('Session not found')
    }
    if (auth.kind === 'user' && session.ownerUserId !== auth.user.id) {
      throw app.httpErrors.forbidden('Session ownership mismatch')
    }
    const events = input.events.map(event => store.appendEvent(id, event.type, event.payload))
    return { events }
  })

  app.get(
    '/v1/sessions/ws/:id/subscribe',
    { websocket: true },
    async (connection, request) => {
      const id = String((request.params as Record<string, string>).id)
      const afterSeq = Number(
        (request.query as Record<string, string | undefined>).after_seq ?? '0',
      )
      const socket = (
        'socket' in connection
          ? connection.socket
          : connection
      ) as {
        send(data: string): void
        close(code?: number, reason?: string): void
        on(event: 'close', handler: () => void): void
      }
      try {
        const auth = await requireWorkerOrUserForSession(request, id)
        const session = store.getSession(id)
        if (!session) {
          socket.close(4001, 'session not found')
          return
        }
        if (auth.kind === 'user' && session.ownerUserId !== auth.user.id) {
          socket.close(4003, 'forbidden')
          return
        }
        for (const event of store.listEvents(id, afterSeq)) {
          socket.send(JSON.stringify(event.payload ?? event))
        }
        const unsubscribe = store.subscribe(id, (event: SessionEventEnvelope) => {
          socket.send(JSON.stringify(event.payload ?? event))
        })
        socket.on('close', unsubscribe)
      } catch (error) {
        logger.warn('websocket authorization failed', {
          sessionId: id,
          error: error instanceof Error ? error.message : String(error),
        })
        socket.close(4003, 'unauthorized')
      }
    },
  )

  app.post('/v1/code/sessions', async request => {
    const user = await requireUser(request)
    const input = createCodeSessionSchema.parse(request.body)
    const session = store.createCodeSession(user.id, input)
    const environmentId = input.environment_id
    if (environmentId) {
      const environment = store.getEnvironment(environmentId)
      if (!environment || environment.ownerUserId !== user.id) {
        throw app.httpErrors.notFound('Environment not found')
      }
      const workToken = createOpaqueSecret()
      store.createWorkItem(
        environment.id,
        session.id,
        workToken,
        sha256(workToken),
      )
      return {
        session,
        dispatch: {
          mode: environment.kind,
          environment_id: environment.id,
          work_token: workToken,
        },
      }
    }
    const mode = input.environment_kind ?? 'raku_cloud'
    if (mode === 'raku_cloud') {
      const { worker } = await issueBridgeCredentials(
        store,
        tokenService,
        session.id,
        user,
      )
      const launched = launcher.launchLocalRunner({
        session,
        workerToken: worker.token,
        user,
      })
      return {
        session,
        dispatch: {
          mode,
          launched,
        },
      }
    }
    return {
      session,
      dispatch: {
        mode,
        launched: false,
      },
    }
  })

  app.post('/v1/code/sessions/:id/bridge', async request => {
    const user = await requireUser(request)
    const id = String((request.params as Record<string, string>).id)
    const session = store.getSession(id)
    if (!session || session.ownerUserId !== user.id) {
      throw app.httpErrors.notFound('Session not found')
    }
    const { worker } = await issueBridgeCredentials(store, tokenService, id, user)
    return {
      session_id: id,
      worker_token: worker.token,
      worker_epoch: store.getSession(id)!.workerEpoch,
      websocket_url: `${config.baseUrl.replace('http', 'ws')}/v1/sessions/ws/${id}/subscribe`,
      expires_in: worker.expiresIn,
    }
  })

  app.post('/v1/code/sessions/:id/worker/connect', async request => {
    const id = String((request.params as Record<string, string>).id)
    const auth = await requireWorkerOrUserForSession(request, id)
    if (auth.kind !== 'worker') {
      throw app.httpErrors.forbidden('Worker token required')
    }
    const workerEpoch = Number(auth.payload.worker_epoch)
    const credential = store.connectWorker(id, workerEpoch)
    if (!credential) {
      throw app.httpErrors.unauthorized('Worker credential is stale')
    }
    return {
      ok: true,
      session_id: id,
      worker_epoch: workerEpoch,
    }
  })

  app.get('/internal/healthz', async request => {
    if (request.headers['x-raku-internal-key'] !== config.internalApiKey) {
      throw app.httpErrors.unauthorized('Missing internal key')
    }
    return { ok: true, request_id: randomUUID() }
  })

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = typeof (error as { statusCode?: number }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500
    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'request_error',
      message: error instanceof Error ? error.message : String(error),
    })
  })

  return { app, store, tokenService, config }
}

export function sessionSummary(session: SessionRecord) {
  return {
    id: session.id,
    title: session.title,
    status: session.status,
    environment_id: session.environmentId,
    worker_epoch: session.workerEpoch,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  }
}
