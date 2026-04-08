import type { RelayConfig } from '@raku-relay/config'
import { MemoryRelayStore, type RelayStore } from './store.js'
import { PostgresRedisRelayStore } from './postgresRedisStore.js'

export async function createRelayStore(
  config: RelayConfig,
): Promise<RelayStore> {
  if (config.storageBackend === 'postgres') {
    return PostgresRedisRelayStore.create({
      postgresUrl: config.postgresUrl,
      redisUrl: config.redisUrl,
      channelPrefix: config.redisChannelPrefix,
    })
  }
  return new MemoryRelayStore()
}

