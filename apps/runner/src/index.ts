import { spawn } from 'child_process'
import { setTimeout as sleep } from 'timers/promises'

type AppendEventsResponse = {
  events: Array<{ seq: number }>
}

const baseUrl = process.env.RAKU_RELAY_BASE_URL
const workerToken = process.env.RAKU_WORKER_TOKEN
const sessionId = process.env.RAKU_SESSION_ID

if (!baseUrl || !workerToken || !sessionId) {
  throw new Error(
    'Runner requires RAKU_RELAY_BASE_URL, RAKU_WORKER_TOKEN, and RAKU_SESSION_ID',
  )
}

const headers = {
  Authorization: `Bearer ${workerToken}`,
  'content-type': 'application/json',
  'x-raku-runner-version': '0.1.0',
  'x-raku-request-origin': 'runner',
}

async function relayFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Relay request failed (${response.status}): ${body}`)
  }
  return response
}

await relayFetch(`/v1/code/sessions/${sessionId}/worker/connect`, {
  method: 'POST',
})

const command =
  process.env.RAKU_RUNNER_COMMAND ??
  'printf "runner connected\\n" && sleep 1 && printf "runner completed\\n"'

await relayFetch(`/v1/sessions/${sessionId}/events`, {
  method: 'POST',
  body: JSON.stringify({
    events: [
      {
        type: 'runner.status',
        payload: { type: 'runner.status', status: 'starting' },
      },
    ],
  }),
})

const subprocess = spawn('sh', ['-lc', command], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

async function streamOutput(
  kind: 'stdout' | 'stderr',
  stream: NodeJS.ReadableStream | null,
) {
  if (!stream) {
    return
  }
  for await (const chunk of stream) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    if (!text) {
      continue
    }
    await relayFetch(`/v1/sessions/${sessionId}/events`, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: `runner.${kind}`,
            payload: { type: `runner.${kind}`, text },
          },
        ],
      }),
    })
  }
}

const [exitCode] = await Promise.all([
  new Promise<number>(resolve => {
    subprocess.once('exit', code => resolve(code ?? 1))
  }),
  streamOutput('stdout', subprocess.stdout),
  streamOutput('stderr', subprocess.stderr),
])

await relayFetch(`/v1/sessions/${sessionId}/events`, {
  method: 'POST',
  body: JSON.stringify({
    events: [
      {
        type: 'runner.exit',
        payload: { type: 'runner.exit', exit_code: exitCode },
      },
    ],
  }),
})

if (exitCode === 0) {
  await relayFetch(`/v1/sessions/${sessionId}/archive`, {
    method: 'POST',
  })
} else {
  await relayFetch(`/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      events: [
        {
          type: 'runner.failure',
          payload: { type: 'runner.failure', exit_code: exitCode },
        },
      ],
    }),
  })
  await sleep(200)
}
