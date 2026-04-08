import { z } from 'zod'

const envSchema = z.object({
  RAKU_RELAY_HOST: z.string().default('0.0.0.0'),
  RAKU_RELAY_PORT: z.coerce.number().int().positive().default(4040),
  RAKU_RELAY_BASE_URL: z.string().url().default('http://localhost:4040'),
  RAKU_RELAY_JWT_ISSUER: z.string().default('raku-relay.local'),
  RAKU_RELAY_PRIVATE_JWK: z.string(),
  RAKU_RELAY_PUBLIC_JWKS: z.string(),
  RAKU_AZURE_TENANT_ID: z.string().min(1),
  RAKU_AZURE_CLIENT_ID: z.string().min(1),
  RAKU_AZURE_ISSUER: z.string().url(),
  RAKU_AZURE_AUDIENCE: z.string().min(1),
  RAKU_AZURE_ALLOWED_TENANTS: z.string().default(''),
  RAKU_AZURE_JWKS_JSON: z.string().optional(),
  RAKU_OIDC_REDIRECT_URIS: z.string().default(''),
  RAKU_OIDC_SUCCESS_URL: z.string().url(),
  RAKU_OIDC_LOGOUT_URL: z.string().url(),
  RAKU_POSTGRES_URL: z.string().min(1),
  RAKU_REDIS_URL: z.string().min(1),
  RAKU_AZURITE_BLOB_URL: z.string().optional(),
  RAKU_STORAGE_BACKEND: z.enum(['memory', 'postgres']).default('memory'),
  RAKU_REQUIRE_TRUSTED_DEVICE: z.coerce.boolean().default(false),
  RAKU_INTERNAL_API_KEY: z.string().min(1),
  RAKU_LOCAL_RUNNER_COMMAND: z.string().optional(),
})

export type RelayConfig = ReturnType<typeof loadConfig>

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env)
  return {
    host: parsed.RAKU_RELAY_HOST,
    port: parsed.RAKU_RELAY_PORT,
    baseUrl: parsed.RAKU_RELAY_BASE_URL,
    jwtIssuer: parsed.RAKU_RELAY_JWT_ISSUER,
    privateJwkJson: parsed.RAKU_RELAY_PRIVATE_JWK,
    publicJwksJson: parsed.RAKU_RELAY_PUBLIC_JWKS,
    azure: {
      tenantId: parsed.RAKU_AZURE_TENANT_ID,
      clientId: parsed.RAKU_AZURE_CLIENT_ID,
      issuer: parsed.RAKU_AZURE_ISSUER,
      audience: parsed.RAKU_AZURE_AUDIENCE,
      allowedTenants: parsed.RAKU_AZURE_ALLOWED_TENANTS.split(',')
        .map(value => value.trim())
        .filter(Boolean),
      jwksJson: parsed.RAKU_AZURE_JWKS_JSON,
      redirectUris: parsed.RAKU_OIDC_REDIRECT_URIS.split(',')
        .map(value => value.trim())
        .filter(Boolean),
      successUrl: parsed.RAKU_OIDC_SUCCESS_URL,
      logoutUrl: parsed.RAKU_OIDC_LOGOUT_URL,
    },
    postgresUrl: parsed.RAKU_POSTGRES_URL,
    redisUrl: parsed.RAKU_REDIS_URL,
    azuriteBlobUrl: parsed.RAKU_AZURITE_BLOB_URL,
    storageBackend: parsed.RAKU_STORAGE_BACKEND,
    requireTrustedDevice: parsed.RAKU_REQUIRE_TRUSTED_DEVICE,
    internalApiKey: parsed.RAKU_INTERNAL_API_KEY,
    localRunnerCommand: parsed.RAKU_LOCAL_RUNNER_COMMAND,
    ttl: {
      accessTokenSeconds: 15 * 60,
      refreshTokenSeconds: 30 * 24 * 60 * 60,
      workerTokenSeconds: 15 * 60,
      trustedDeviceSeconds: 90 * 24 * 60 * 60,
    },
  }
}
