import { spawn } from 'child_process'
import type { RelayConfig } from '@raku-relay/config'
import { logger } from '@raku-relay/logging'
import type { SessionRecord, UserRecord } from '../lib/store.js'

export class RunnerLauncher {
  constructor(private readonly config: RelayConfig) {}

  launchLocalRunner(input: {
    session: SessionRecord
    workerToken: string
    user: UserRecord
  }): boolean {
    if (!this.config.localRunnerCommand) {
      return false
    }
    const child = spawn(this.config.localRunnerCommand, {
      shell: true,
      env: {
        ...process.env,
        RAKU_RELAY_BASE_URL: this.config.baseUrl,
        RAKU_WORKER_TOKEN: input.workerToken,
        RAKU_SESSION_ID: input.session.id,
        RAKU_RUNNER_USER_ID: input.user.id,
        RAKU_INTERNAL_API_KEY: this.config.internalApiKey,
      },
      stdio: 'inherit',
    })
    logger.info('launched local runner', {
      pid: child.pid,
      sessionId: input.session.id,
    })
    return true
  }
}

