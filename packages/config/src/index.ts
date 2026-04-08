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
  RAKU_AZURE_CLIENT_SECRET: z.string().optional(),
  RAKU_AZURE_ISSUER: z.string().url(),
  RAKU_AZURE_AUDIENCE: z.string().min(1),
  RAKU_AZURE_AUTHORIZE_URL: z.string().url().optional(),
  RAKU_AZURE_TOKEN_URL: z.string().url().optional(),
  RAKU_AZURE_ALLOWED_TENANTS: z.string().default(''),
  RAKU_AZURE_JWKS_JSON: z.string().optional(),
  RAKU_AZURE_REDIRECT_URI: z.string().url().optional(),
  RAKU_OIDC_REDIRECT_URIS: z.string().default(''),
  RAKU_OIDC_SUCCESS_URL: z.string().url(),
  RAKU_OIDC_LOGOUT_URL: z.string().url(),
  RAKU_ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:4000,https://app.raku.app,https://raku.app'),
  RAKU_POSTGRES_URL: z.string().min(1),
  RAKU_REDIS_URL: z.string().min(1),
  RAKU_AZURITE_BLOB_URL: z.string().optional(),
  RAKU_STORAGE_BACKEND: z.enum(['memory', 'postgres']).default('memory'),
  RAKU_REDIS_CHANNEL_PREFIX: z.string().default('raku-relay'),
  RAKU_REQUIRE_TRUSTED_DEVICE: z.coerce.boolean().default(false),
  RAKU_INTERNAL_API_KEY: z.string().min(1),
  RAKU_LOCAL_RUNNER_COMMAND: z.string().optional(),
})

export type RelayConfig = ReturnType<typeof loadConfig>

function azureAuthorityBase(issuer: string) {
  return issuer.replace(/\/v2\.0\/?$/, '')
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env)
  const azureAuthority = azureAuthorityBase(parsed.RAKU_AZURE_ISSUER)
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
      clientSecret: parsed.RAKU_AZURE_CLIENT_SECRET,
      issuer: parsed.RAKU_AZURE_ISSUER,
      audience: parsed.RAKU_AZURE_AUDIENCE,
      authorizeUrl:
        parsed.RAKU_AZURE_AUTHORIZE_URL ??
        `${azureAuthority}/oauth2/v2.0/authorize`,
      tokenUrl:
        parsed.RAKU_AZURE_TOKEN_URL ??
        `${azureAuthority}/oauth2/v2.0/token`,
      allowedTenants: parsed.RAKU_AZURE_ALLOWED_TENANTS.split(',')
        .map(value => value.trim())
        .filter(Boolean),
      jwksJson: parsed.RAKU_AZURE_JWKS_JSON,
      redirectUri:
        parsed.RAKU_AZURE_REDIRECT_URI ??
        `${parsed.RAKU_RELAY_BASE_URL.replace(/\/$/, '')}/v1/oauth/callback`,
      redirectUris: parsed.RAKU_OIDC_REDIRECT_URIS.split(',')
        .map(value => value.trim())
        .filter(Boolean),
      successUrl: parsed.RAKU_OIDC_SUCCESS_URL,
      logoutUrl: parsed.RAKU_OIDC_LOGOUT_URL,
    },
    allowedOrigins: parsed.RAKU_ALLOWED_ORIGINS.split(',')
      .map(value => value.trim())
      .filter(Boolean),
    postgresUrl: parsed.RAKU_POSTGRES_URL,
    redisUrl: parsed.RAKU_REDIS_URL,
    azuriteBlobUrl: parsed.RAKU_AZURITE_BLOB_URL,
    storageBackend: parsed.RAKU_STORAGE_BACKEND,
    redisChannelPrefix: parsed.RAKU_REDIS_CHANNEL_PREFIX,
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
