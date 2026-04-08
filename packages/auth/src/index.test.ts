import { describe, expect, test } from 'bun:test'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { AzureTokenValidator, RelayTokenService } from './index.js'

async function createKeyMaterial() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', {
    extractable: true,
  })
  const publicJwk = await exportJWK(publicKey)
  const privateJwk = await exportJWK(privateKey)
  return {
    publicJwk: { ...publicJwk, kid: 'test-key', alg: 'ES256', use: 'sig' },
    privateJwk: { ...privateJwk, kid: 'test-key', alg: 'ES256', use: 'sig' },
    privateKey,
  }
}

describe('auth package', () => {
  test('validates Azure token for allowed tenant', async () => {
    const keys = await createKeyMaterial()
    const validator = new AzureTokenValidator({
      issuer: 'https://login.microsoftonline.com/test/v2.0',
      audience: 'api://raku-relay',
      clientId: 'client-id',
      clientSecret: 'secret',
      tenantId: 'tenant-a',
      authorizeUrl: 'https://login.microsoftonline.com/test/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/test/oauth2/v2.0/token',
      redirectUri: 'http://localhost:4040/v1/oauth/callback',
      allowedTenants: ['tenant-b'],
      verificationKey: keys.publicJwk,
    })
    const token = await new SignJWT({
      tid: 'tenant-b',
      email: 'martin@example.com',
      name: 'Martin',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuer('https://login.microsoftonline.com/test/v2.0')
      .setAudience('api://raku-relay')
      .setSubject('azure-user-1')
      .setExpirationTime('5m')
      .setIssuedAt()
      .sign(keys.privateKey)

    const identity = await validator.validateIdToken(token)
    expect(identity.tenantId).toBe('tenant-b')
    expect(identity.email).toBe('martin@example.com')
  })

  test('rejects Azure token for tenant outside allowlist', async () => {
    const keys = await createKeyMaterial()
    const validator = new AzureTokenValidator({
      issuer: 'https://login.microsoftonline.com/test/v2.0',
      audience: 'api://raku-relay',
      clientId: 'client-id',
      clientSecret: 'secret',
      tenantId: 'tenant-a',
      authorizeUrl: 'https://login.microsoftonline.com/test/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/test/oauth2/v2.0/token',
      redirectUri: 'http://localhost:4040/v1/oauth/callback',
      allowedTenants: [],
      verificationKey: keys.publicJwk,
    })
    const token = await new SignJWT({
      tid: 'tenant-z',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuer('https://login.microsoftonline.com/test/v2.0')
      .setAudience('api://raku-relay')
      .setSubject('azure-user-1')
      .setExpirationTime('5m')
      .setIssuedAt()
      .sign(keys.privateKey)

    await expect(validator.validateIdToken(token)).rejects.toThrow(
      'Azure tenant is not allowed',
    )
  })

  test('issues and verifies relay access and worker tokens', async () => {
    const keys = await createKeyMaterial()
    const service = new RelayTokenService({
      issuer: 'raku-relay.test',
      privateJwk: keys.privateJwk,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 60,
      workerTokenTtlSeconds: 900,
      trustedDeviceTtlSeconds: 60,
    })
    const access = await service.issueAccessToken({
      sub: 'user-1',
      tenant_id: 'tenant-a',
      scopes: ['relay:read'],
      session_capabilities: ['sessions'],
    })
    const worker = await service.issueWorkerToken({
      sub: 'user-1',
      tenant_id: 'tenant-a',
      session_id: 'session-1',
      worker_epoch: 3,
      role: 'worker',
    })

    const accessClaims = await service.verifyRelayAccessToken(access.token)
    const workerClaims = await service.verifyWorkerToken(worker.token)
    expect(accessClaims.sub).toBe('user-1')
    expect(workerClaims.session_id).toBe('session-1')
    expect(workerClaims.worker_epoch).toBe(3)
  })
})
