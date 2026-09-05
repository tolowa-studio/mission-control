import { logger } from './logger'

// ---------------------------------------------------------------------------
// Config — env vars, all optional with sane defaults
// ---------------------------------------------------------------------------

export function getHermesA2AConfig() {
  return {
    url: (process.env.HERMES_A2A_URL || 'http://127.0.0.1:9900/').replace(/\/$/, '') + '/',
    token: process.env.HERMES_A2A_TOKEN || null,
    timeoutMs: parseInt(process.env.HERMES_A2A_TIMEOUT_MS || '120000', 10) || 120_000,
  }
}

// ---------------------------------------------------------------------------
// A2A types — only what we consume, not the full spec
// ---------------------------------------------------------------------------

interface A2APart {
  text?: string
  kind?: string
  mediaType?: string
}

interface A2AMessage {
  role: string
  parts: A2APart[]
  messageId?: string
}

interface A2AStatus {
  state: string
  timestamp?: string
  message?: A2AMessage
}

interface A2AArtifact {
  artifactId?: string
  parts: A2APart[]
}

interface A2ATaskResult {
  id: string
  contextId?: string
  status: A2AStatus
  artifacts?: A2AArtifact[]
}

// ---------------------------------------------------------------------------
// Public result shape — what MC consumes
// ---------------------------------------------------------------------------

export interface HermesDispatchResult {
  taskId: string
  contextId: string | null
  state: string
  text: string | null
  artifacts: string[]
}

// ---------------------------------------------------------------------------
// A2A state mapping
// ---------------------------------------------------------------------------

const TERMINAL_STATES = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
])

export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state)
}

export function mapA2AStateToMC(state: string): 'success' | 'failed' | 'cancelled' | 'running' {
  switch (state) {
    case 'TASK_STATE_COMPLETED': return 'success'
    case 'TASK_STATE_FAILED': return 'failed'
    case 'TASK_STATE_CANCELED': return 'cancelled'
    default: return 'running'
  }
}

// ---------------------------------------------------------------------------
// Text extraction — artifacts preferred, status.message fallback
// ---------------------------------------------------------------------------

export function extractTextFromParts(parts: A2APart[]): string {
  return parts
    .map((p) => p.text?.trim())
    .filter(Boolean)
    .join('\n')
}

export function extractResultText(task: A2ATaskResult): { text: string | null; artifacts: string[] } {
  const artifacts: string[] = []

  if (task.artifacts?.length) {
    for (const artifact of task.artifacts) {
      const t = extractTextFromParts(artifact.parts)
      if (t) artifacts.push(t)
    }
  }

  if (artifacts.length > 0) {
    return { text: artifacts.join('\n\n'), artifacts }
  }

  const statusText = task.status?.message?.parts
    ? extractTextFromParts(task.status.message.parts)
    : null

  return { text: statusText || null, artifacts }
}

// ---------------------------------------------------------------------------
// JSON-RPC transport
// ---------------------------------------------------------------------------

let nextJsonRpcId = 1

async function callA2A<T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  const cfg = getHermesA2AConfig()
  const effectiveTimeout = timeoutMs ?? cfg.timeoutMs

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: `mc-${nextJsonRpcId++}`,
    method,
    params,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), effectiveTimeout)

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Hermes A2A HTTP ${res.status}: ${errBody.substring(0, 500)}`)
    }

    const json = await res.json() as { result?: T; error?: { code: number; message: string } }

    if (json.error) {
      throw new Error(`Hermes A2A RPC error ${json.error.code}: ${json.error.message}`)
    }

    return json.result as T
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function buildResult(task: A2ATaskResult): HermesDispatchResult {
  const { text, artifacts } = extractResultText(task)
  return {
    taskId: task.id,
    contextId: task.contextId ?? null,
    state: task.status.state,
    text,
    artifacts,
  }
}

export async function dispatchToHermes(
  prompt: string,
  opts?: { messageId?: string; timeoutMs?: number },
): Promise<HermesDispatchResult> {
  const messageId = opts?.messageId ?? `mc-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const task = await callA2A<A2ATaskResult>('message/send', {
    message: {
      role: 'user',
      messageId,
      parts: [{ kind: 'text', text: prompt }],
    },
  }, opts?.timeoutMs)

  return buildResult(task)
}

export async function getHermesTask(taskId: string): Promise<HermesDispatchResult> {
  const task = await callA2A<A2ATaskResult>('tasks/get', { id: taskId })
  return buildResult(task)
}

export async function cancelHermesTask(taskId: string): Promise<HermesDispatchResult> {
  const task = await callA2A<A2ATaskResult>('tasks/cancel', { id: taskId })
  return buildResult(task)
}

// ---------------------------------------------------------------------------
// Poll with backoff — used by the dispatch integration in task-dispatch.ts
// ---------------------------------------------------------------------------

export async function pollUntilTerminal(
  taskId: string,
  timeoutMs: number,
): Promise<HermesDispatchResult> {
  const deadline = Date.now() + timeoutMs
  let delay = 500
  const maxDelay = 5_000

  while (Date.now() < deadline) {
    const result = await getHermesTask(taskId)
    if (isTerminalState(result.state)) return result

    const remaining = deadline - Date.now()
    if (remaining <= 0) break

    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)))
    delay = Math.min(delay * 1.5, maxDelay)
  }

  logger.warn({ taskId, timeoutMs }, 'Hermes A2A poll timed out before terminal state')
  return getHermesTask(taskId)
}
