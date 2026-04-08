import { buildServer } from './server.js'
import { logger } from '@raku-relay/logging'

const { app, config } = await buildServer()

try {
  await app.listen({ host: config.host, port: config.port })
  logger.info('raku-relay api listening', {
    host: config.host,
    port: config.port,
  })
} catch (error) {
  logger.error('failed to start api', {
    error: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
}

