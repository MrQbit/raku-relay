import { z } from 'zod'

export const environmentKindSchema = z.enum(['local_bridge', 'raku_cloud'])
export type EnvironmentKind = z.infer<typeof environmentKindSchema>

export const sessionStatusSchema = z.enum([
  'queued',
  'active',
  'archived',
  'completed',
  'failed',
])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const sessionEventEnvelopeSchema = z.object({
  session_id: z.string(),
  seq: z.number().int().positive(),
  type: z.string(),
  payload: z.unknown(),
  created_at: z.string(),
})
export type SessionEventEnvelope = z.infer<typeof sessionEventEnvelopeSchema>

export const registerEnvironmentSchema = z.object({
  machine_name: z.string().min(1),
  directory: z.string().min(1),
  branch: z.string().optional(),
  git_repo_url: z.string().optional(),
  max_sessions: z.number().int().positive().max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  environment_id: z.string().optional(),
})
export type RegisterEnvironmentInput = z.infer<typeof registerEnvironmentSchema>

export const registerEnvironmentResponseSchema = z.object({
  environment_id: z.string(),
  environment_secret: z.string(),
  kind: environmentKindSchema,
})
export type RegisterEnvironmentResponse = z.infer<
  typeof registerEnvironmentResponseSchema
>

export const createSessionSchema = z.object({
  title: z.string().optional(),
  environment_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type CreateSessionInput = z.infer<typeof createSessionSchema>

export const createCodeSessionSchema = z.object({
  title: z.string().optional(),
  environment_id: z.string().optional(),
  environment_kind: environmentKindSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  seed_command: z.string().optional(),
  workspace: z.object({
    git_url: z.string().optional(),
    branch: z.string().optional(),
  }).optional(),
})
export type CreateCodeSessionInput = z.infer<typeof createCodeSessionSchema>

export const updateSessionSchema = z.object({
  title: z.string().optional(),
  status: sessionStatusSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>

export const appendSessionEventsSchema = z.object({
  events: z.array(
    z.object({
      type: z.string().min(1),
      payload: z.unknown(),
    }),
  ).min(1),
})
export type AppendSessionEventsInput = z.infer<typeof appendSessionEventsSchema>

export const authExchangeSchema = z.object({
  id_token: z.string().min(1),
  trusted_device_token: z.string().optional(),
})
export type AuthExchangeInput = z.infer<typeof authExchangeSchema>

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1),
})
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>

export const trustedDeviceRequestSchema = z.object({
  label: z.string().min(1).max(120),
})
export type TrustedDeviceRequest = z.infer<typeof trustedDeviceRequestSchema>

export const workResponseSchema = z.object({
  id: z.string(),
  token: z.string(),
  status: z.string(),
  created_at: z.string(),
  data: z.object({
    type: z.string(),
    id: z.string(),
    session_id: z.string(),
    title: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
})
export type WorkResponse = z.infer<typeof workResponseSchema>

export const bridgeCredentialsSchema = z.object({
  session_id: z.string(),
  worker_token: z.string(),
  worker_epoch: z.number().int().nonnegative(),
  websocket_url: z.string(),
  expires_in: z.number().int().positive(),
})
export type BridgeCredentials = z.infer<typeof bridgeCredentialsSchema>

export const relayAuthResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive(),
  token_type: z.literal('Bearer'),
  user: z.object({
    id: z.string(),
    tenant_id: z.string(),
    email: z.string().nullable(),
    display_name: z.string().nullable(),
  }),
})
export type RelayAuthResponse = z.infer<typeof relayAuthResponseSchema>

export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: sessionStatusSchema,
  environment_id: z.string().optional(),
  worker_epoch: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type SessionSummary = z.infer<typeof sessionSummarySchema>

export const environmentSummarySchema = z.object({
  id: z.string(),
  kind: environmentKindSchema,
  machine_name: z.string(),
  directory: z.string(),
  branch: z.string().optional(),
  git_repo_url: z.string().optional(),
  max_sessions: z.number().int().positive(),
  archived_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type EnvironmentSummary = z.infer<typeof environmentSummarySchema>

export const trustedDeviceSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  expires_at: z.string(),
  last_used_at: z.string().optional(),
})
export type TrustedDeviceSummary = z.infer<typeof trustedDeviceSummarySchema>

export const relayMeSchema = z.object({
  user: z.object({
    id: z.string(),
    tenant_id: z.string(),
    email: z.string().nullable(),
    display_name: z.string().nullable(),
  }),
  features: z.object({
    trusted_device_required: z.boolean(),
  }),
})
export type RelayMe = z.infer<typeof relayMeSchema>

export const sessionControlSchema = z.object({
  action: z.enum(['cancel', 'stop', 'archive', 'reconnect_worker']),
  payload: z.record(z.string(), z.unknown()).optional(),
})
export type SessionControlInput = z.infer<typeof sessionControlSchema>

export const sessionReplySchema = z.object({
  prompt_id: z.string().min(1),
  reply: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type SessionReplyInput = z.infer<typeof sessionReplySchema>

export type RelayClaims = {
  sub: string
  tenant_id: string
  scopes: string[]
  session_capabilities: string[]
}

export type WorkerClaims = {
  sub: string
  tenant_id: string
  session_id: string
  worker_epoch: number
  role: 'worker'
}
