import { createHash, randomBytes, randomUUID } from 'crypto'
import {
  SignJWT,
  exportJWK,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose'
import type { RelayClaims, WorkerClaims } from '@raku-relay/contracts'

type VerificationKey = JWK | CryptoKey
type ImportedKey = CryptoKey | Uint8Array

type AzureValidationConfig = {
  issuer: string
  audience: string
  clientId: string
  tenantId: string
  allowedTenants: string[]
  verificationKey: VerificationKey
}

type TokenServiceConfig = {
  issuer: string
  privateJwk: JWK
  accessTokenTtlSeconds: number
  refreshTokenTtlSeconds: number
  workerTokenTtlSeconds: number
  trustedDeviceTtlSeconds: number
}

export type AzureIdentity = {
  subject: string
  tenantId: string
  email: string | null
  displayName: string | null
  rawClaims: JWTPayload
}

export class AzureTokenValidator {
  constructor(private readonly config: AzureValidationConfig) {}

  async validateIdToken(token: string): Promise<AzureIdentity> {
    const key =
      'kty' in this.config.verificationKey
        ? await importJWK(this.config.verificationKey)
        : this.config.verificationKey
    const { payload } = await jwtVerify(token, key, {
      issuer: this.config.issuer,
      audience: this.config.audience,
    })
    const tenantId = String(payload.tid ?? '')
    const allowed = new Set([
      this.config.tenantId,
      ...this.config.allowedTenants,
    ].filter(Boolean))
    if (!tenantId || !allowed.has(tenantId)) {
      throw new Error('Azure tenant is not allowed')
    }
    const audienceMatches =
      payload.aud === this.config.audience || payload.aud === this.config.clientId
    if (!audienceMatches) {
      throw new Error('Azure audience mismatch')
    }
    return {
      subject: String(payload.sub),
      tenantId,
      email:
        typeof payload.email === 'string'
          ? payload.email
          : typeof payload.preferred_username === 'string'
            ? payload.preferred_username
            : null,
      displayName:
        typeof payload.name === 'string' ? payload.name : null,
      rawClaims: payload,
    }
  }
}

export class RelayTokenService {
  private signingKeyPromise: Promise<ImportedKey>
  private verificationKeyPromise: Promise<ImportedKey>

  constructor(private readonly config: TokenServiceConfig) {
    this.signingKeyPromise = importJWK(config.privateJwk, 'ES256')
    const publicJwk: JWK = {
      ...config.privateJwk,
    }
    delete publicJwk.d
    delete publicJwk.p
    delete publicJwk.q
    delete publicJwk.dp
    delete publicJwk.dq
    delete publicJwk.qi
    this.verificationKeyPromise = importJWK(publicJwk, 'ES256')
  }

  async issueAccessToken(
    claims: RelayClaims,
  ): Promise<{ token: string; expiresIn: number }> {
    const token = await new SignJWT({
      scopes: claims.scopes,
      session_capabilities: claims.session_capabilities,
      tenant_id: claims.tenant_id,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.config.privateJwk.kid })
      .setIssuer(this.config.issuer)
      .setSubject(claims.sub)
      .setAudience('raku-relay')
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTokenTtlSeconds}s`)
      .sign(await this.signingKeyPromise)
    return { token, expiresIn: this.config.accessTokenTtlSeconds }
  }

  async issueWorkerToken(
    claims: WorkerClaims,
  ): Promise<{ token: string; expiresIn: number; jti: string }> {
    const jti = randomUUID()
    const token = await new SignJWT({
      tenant_id: claims.tenant_id,
      session_id: claims.session_id,
      worker_epoch: claims.worker_epoch,
      role: claims.role,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.config.privateJwk.kid })
      .setIssuer(this.config.issuer)
      .setSubject(claims.sub)
      .setAudience('raku-relay-worker')
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${this.config.workerTokenTtlSeconds}s`)
      .sign(await this.signingKeyPromise)
    return { token, expiresIn: this.config.workerTokenTtlSeconds, jti }
  }

  issueOpaqueRefreshToken(): {
    token: string
    hash: string
    expiresIn: number
  } {
    const token = randomBytes(32).toString('base64url')
    return {
      token,
      hash: sha256(token),
      expiresIn: this.config.refreshTokenTtlSeconds,
    }
  }

  issueTrustedDeviceToken(): {
    token: string
    hash: string
    expiresIn: number
  } {
    const token = randomBytes(32).toString('base64url')
    return {
      token,
      hash: sha256(token),
      expiresIn: this.config.trustedDeviceTtlSeconds,
    }
  }

  async verifyRelayAccessToken(token: string): Promise<JWTPayload> {
    const key = await this.verificationKeyPromise
    const { payload } = await jwtVerify(token, key, {
      issuer: this.config.issuer,
      audience: 'raku-relay',
    })
    return payload
  }

  async verifyWorkerToken(token: string): Promise<JWTPayload> {
    const key = await this.verificationKeyPromise
    const { payload } = await jwtVerify(token, key, {
      issuer: this.config.issuer,
      audience: 'raku-relay-worker',
    })
    return payload
  }

  async exportPublicJwk(): Promise<JWK> {
    return exportJWK(await this.signingKeyPromise)
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
