import { describe, expect, test } from 'bun:test'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { buildServer } from './server.js'

async function createFixture(requireTrustedDevice = false) {
  const { publicKey, privateKey } = await generateKeyPair('ES256', {
    extractable: true,
  })
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'relay-test', alg: 'ES256', use: 'sig' }
  const privateJwk = { ...(await exportJWK(privateKey)), kid: 'relay-test', alg: 'ES256', use: 'sig' }
  const config = {
    host: '127.0.0.1',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    jwtIssuer: 'raku-relay.test',
    privateJwkJson: JSON.stringify(privateJwk),
    publicJwksJson: JSON.stringify({ keys: [publicJwk] }),
    azure: {
      tenantId: 'tenant-a',
      clientId: 'client-id',
      issuer: 'https://login.microsoftonline.com/test/v2.0',
      audience: 'api://raku-relay',
      allowedTenants: [],
      jwksJson: JSON.stringify({ keys: [publicJwk] }),
      redirectUris: [],
      successUrl: 'http://localhost/success',
      logoutUrl: 'http://localhost/logout',
    },
    allowedOrigins: ['http://localhost:3000'],
    postgresUrl: 'postgres://unused',
    redisUrl: 'redis://unused',
    redisChannelPrefix: 'test-relay',
    azuriteBlobUrl: undefined,
    storageBackend: 'memory' as const,
    requireTrustedDevice,
    internalApiKey: 'internal-test',
    localRunnerCommand: undefined,
    ttl: {
      accessTokenSeconds: 900,
      refreshTokenSeconds: 3600,
      workerTokenSeconds: 900,
      trustedDeviceSeconds: 3600,
    },
  }
  const built = await buildServer({ config })
  const token = await new SignJWT({
    tid: 'tenant-a',
    email: 'martin@example.com',
    name: 'Martin',
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'relay-test' })
    .setIssuer(config.azure.issuer)
    .setAudience(config.azure.audience)
    .setSubject('azure-sub-1')
    .setExpirationTime('5m')
    .setIssuedAt()
    .sign(privateKey)
  return { ...built, azureToken: token }
}

describe('relay api', () => {
  test('supports auth, bridge registration, work polling, and worker connect', async () => {
    const { app, azureToken } = await createFixture()
    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/azure/exchange',
      payload: { id_token: azureToken },
    })
    expect(exchange.statusCode).toBe(200)
    const auth = await exchange.json()
    const accessToken = auth.access_token as string

    const register = await app.inject({
      method: 'POST',
      url: '/v1/environments/bridge',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        machine_name: 'devbox',
        directory: '/workspace',
        branch: 'main',
      },
    })
    expect(register.statusCode).toBe(200)
    const environment = await register.json()

    const codeSession = await app.inject({
      method: 'POST',
      url: '/v1/code/sessions',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title: 'Bridge work',
        environment_id: environment.environment_id,
      },
    })
    expect(codeSession.statusCode).toBe(200)
    const codeJson = await codeSession.json()
    expect(codeJson.dispatch.mode).toBe('local_bridge')

    const poll = await app.inject({
      method: 'GET',
      url: `/v1/environments/${environment.environment_id}/work/poll`,
      headers: { authorization: `Bearer ${environment.environment_secret}` },
    })
    expect(poll.statusCode).toBe(200)
    const work = await poll.json()
    expect(work.data.session_id).toBe(codeJson.session.id)

    const ack = await app.inject({
      method: 'POST',
      url: `/v1/environments/${environment.environment_id}/work/${work.id}/ack`,
      headers: { authorization: `Bearer ${work.token}` },
    })
    expect(ack.statusCode).toBe(200)

    const bridge = await app.inject({
      method: 'POST',
      url: `/v1/code/sessions/${codeJson.session.id}/bridge`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(bridge.statusCode).toBe(200)
    const bridgeJson = await bridge.json()

    const connect = await app.inject({
      method: 'POST',
      url: `/v1/code/sessions/${codeJson.session.id}/worker/connect`,
      headers: { authorization: `Bearer ${bridgeJson.worker_token}` },
    })
    expect(connect.statusCode).toBe(200)
  })

  test('enforces trusted devices when enabled', async () => {
    const { app, azureToken } = await createFixture(true)
    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/azure/exchange',
      payload: { id_token: azureToken },
    })
    const auth = await exchange.json()
    const accessToken = auth.access_token as string

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/environments/bridge',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        machine_name: 'devbox',
        directory: '/workspace',
      },
    })
    expect(blocked.statusCode).toBe(401)

    const trusted = await app.inject({
      method: 'POST',
      url: '/v1/auth/trusted-devices',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { label: 'Martin laptop' },
    })
    expect(trusted.statusCode).toBe(200)
    const trustedJson = await trusted.json()

    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/environments/bridge',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-trusted-device-token': trustedJson.trusted_device_token,
      },
      payload: {
        machine_name: 'devbox',
        directory: '/workspace',
      },
    })
    expect(allowed.statusCode).toBe(200)
  })

  test('supports profile, list, control, reply, and trusted device management endpoints', async () => {
    const { app, azureToken } = await createFixture()
    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/azure/exchange',
      payload: { id_token: azureToken },
    })
    const auth = await exchange.json()
    const accessToken = auth.access_token as string

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(me.statusCode).toBe(200)
    const meJson = await me.json()
    expect(meJson.user.email).toBe('martin@example.com')

    const trusted = await app.inject({
      method: 'POST',
      url: '/v1/auth/trusted-devices',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { label: 'Browser session' },
    })
    expect(trusted.statusCode).toBe(200)

    const devices = await app.inject({
      method: 'GET',
      url: '/v1/trusted-devices',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(devices.statusCode).toBe(200)
    const devicesJson = await devices.json()
    expect(devicesJson.trusted_devices).toHaveLength(1)

    const createSession = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: 'Web session' },
    })
    expect(createSession.statusCode).toBe(200)
    const sessionJson = await createSession.json()
    const sessionId = sessionJson.session.id as string

    const listSessions = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(listSessions.statusCode).toBe(200)
    const listJson = await listSessions.json()
    expect(listJson.sessions).toHaveLength(1)

    const control = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/control`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { action: 'stop' },
    })
    expect(control.statusCode).toBe(200)
    const controlJson = await control.json()
    expect(controlJson.session.status).toBe('failed')

    const reply = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/reply`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        prompt_id: 'prompt-1',
        reply: 'allow',
      },
    })
    expect(reply.statusCode).toBe(200)

    const sessionDetail = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(sessionDetail.statusCode).toBe(200)
    const detailJson = await sessionDetail.json()
    expect(detailJson.events).toHaveLength(2)

    const deleteTrusted = await app.inject({
      method: 'DELETE',
      url: `/v1/trusted-devices/${devicesJson.trusted_devices[0].id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(deleteTrusted.statusCode).toBe(200)
  })
})
