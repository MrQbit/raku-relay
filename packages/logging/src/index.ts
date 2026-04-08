type Level = 'info' | 'warn' | 'error' | 'debug'

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload))
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    emit('info', message, meta)
  },
  warn(message: string, meta?: Record<string, unknown>) {
    emit('warn', message, meta)
  },
  error(message: string, meta?: Record<string, unknown>) {
    emit('error', message, meta)
  },
  debug(message: string, meta?: Record<string, unknown>) {
    emit('debug', message, meta)
  },
}

export function audit(
  action: string,
  meta: Record<string, unknown> = {},
): void {
  logger.info(`audit:${action}`, meta)
}

