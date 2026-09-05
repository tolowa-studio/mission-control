// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dispatchToHermes,
  getHermesTask,
  cancelHermesTask,
  pollUntilTerminal,
  extractResultText,
  isTerminalState,
  mapA2AStateToMC,
} from '../hermes-a2a'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function a2aResult(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-abc123',
    contextId: 'ctx-def456',
    status: {
      state: 'TASK_STATE_COMPLETED',
      timestamp: '2026-09-05T00:00:00Z',
      message: {
        role: 'ROLE_AGENT',
        parts: [{ text: 'status-text', mediaType: 'text/plain' }],
      },
    },
    artifacts: [
      { artifactId: 'art-1', parts: [{ text: 'artifact-text', mediaType: 'text/plain' }] },
    ],
    ...overrides,
  }
}

function jsonRpcOk(result: unknown) {
  return { jsonrpc: '2.0', id: 'mc-1', result }
}

function mockFetchOk(result: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => jsonRpcOk(result),
  })
}

// ---------------------------------------------------------------------------
// extractResultText
// ---------------------------------------------------------------------------

describe('extractResultText', () => {
  it('prefers artifact text over status.message text', () => {
    const task = a2aResult()
    const { text, artifacts } = extractResultText(task as any)
    expect(text).toBe('artifact-text')
    expect(artifacts).toEqual(['artifact-text'])
  })

  it('falls back to status.message when no artifacts', () => {
    const task = a2aResult({ artifacts: [] })
    const { text, artifacts } = extractResultText(task as any)
    expect(text).toBe('status-text')
    expect(artifacts).toEqual([])
  })

  it('returns null when neither artifacts nor status.message have text', () => {
    const task = a2aResult({
      artifacts: [],
      status: { state: 'TASK_STATE_COMPLETED', message: { role: 'ROLE_AGENT', parts: [] } },
    })
    const { text } = extractResultText(task as any)
    expect(text).toBeNull()
  })

  it('concatenates multiple artifact parts', () => {
    const task = a2aResult({
      artifacts: [
        { artifactId: 'a1', parts: [{ text: 'first' }] },
        { artifactId: 'a2', parts: [{ text: 'second' }] },
      ],
    })
    const { text, artifacts } = extractResultText(task as any)
    expect(text).toBe('first\n\nsecond')
    expect(artifacts).toEqual(['first', 'second'])
  })
})

// ---------------------------------------------------------------------------
// State mapping
// ---------------------------------------------------------------------------

describe('state mapping', () => {
  it('maps terminal states', () => {
    expect(isTerminalState('TASK_STATE_COMPLETED')).toBe(true)
    expect(isTerminalState('TASK_STATE_FAILED')).toBe(true)
    expect(isTerminalState('TASK_STATE_CANCELED')).toBe(true)
  })

  it('maps non-terminal states', () => {
    expect(isTerminalState('TASK_STATE_RUNNING')).toBe(false)
    expect(isTerminalState('TASK_STATE_PENDING')).toBe(false)
  })

  it('maps A2A state to MC outcome', () => {
    expect(mapA2AStateToMC('TASK_STATE_COMPLETED')).toBe('success')
    expect(mapA2AStateToMC('TASK_STATE_FAILED')).toBe('failed')
    expect(mapA2AStateToMC('TASK_STATE_CANCELED')).toBe('cancelled')
    expect(mapA2AStateToMC('TASK_STATE_RUNNING')).toBe('running')
    expect(mapA2AStateToMC('UNKNOWN')).toBe('running')
  })
})

// ---------------------------------------------------------------------------
// dispatchToHermes
// ---------------------------------------------------------------------------

describe('dispatchToHermes', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('sends message/send and returns extracted result on terminal state', async () => {
    globalThis.fetch = mockFetchOk(a2aResult())

    const result = await dispatchToHermes('Hello Hermes')
    expect(result.taskId).toBe('task-abc123')
    expect(result.contextId).toBe('ctx-def456')
    expect(result.state).toBe('TASK_STATE_COMPLETED')
    expect(result.text).toBe('artifact-text')

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.method).toBe('message/send')
    expect(body.params.message.parts[0].text).toBe('Hello Hermes')
  })

  it('includes Authorization header when token is set', async () => {
    process.env.HERMES_A2A_TOKEN = 'test-bearer-token'
    globalThis.fetch = mockFetchOk(a2aResult())

    await dispatchToHermes('test')

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].headers['Authorization']).toBe('Bearer test-bearer-token')

    delete process.env.HERMES_A2A_TOKEN
  })

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal server error',
    })

    await expect(dispatchToHermes('fail')).rejects.toThrow('Hermes A2A HTTP 500')
  })

  it('throws on JSON-RPC error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 'mc-1',
        error: { code: -32600, message: 'Invalid request' },
      }),
    })

    await expect(dispatchToHermes('fail')).rejects.toThrow('Hermes A2A RPC error -32600')
  })
})

// ---------------------------------------------------------------------------
// getHermesTask
// ---------------------------------------------------------------------------

describe('getHermesTask', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('sends tasks/get with the task ID', async () => {
    globalThis.fetch = mockFetchOk(a2aResult())

    const result = await getHermesTask('task-abc123')
    expect(result.taskId).toBe('task-abc123')

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.method).toBe('tasks/get')
    expect(body.params.id).toBe('task-abc123')
  })
})

// ---------------------------------------------------------------------------
// cancelHermesTask
// ---------------------------------------------------------------------------

describe('cancelHermesTask', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('sends tasks/cancel', async () => {
    const canceled = a2aResult({ status: { state: 'TASK_STATE_CANCELED' } })
    globalThis.fetch = mockFetchOk(canceled)

    const result = await cancelHermesTask('task-abc123')
    expect(result.state).toBe('TASK_STATE_CANCELED')

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(call[1].body)
    expect(body.method).toBe('tasks/cancel')
  })
})

// ---------------------------------------------------------------------------
// pollUntilTerminal
// ---------------------------------------------------------------------------

describe('pollUntilTerminal', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('returns immediately when already terminal', async () => {
    globalThis.fetch = mockFetchOk(a2aResult())

    const result = await pollUntilTerminal('task-abc123', 5_000)
    expect(result.state).toBe('TASK_STATE_COMPLETED')
    expect(result.text).toBe('artifact-text')
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
  })

  it('polls until terminal state is reached', async () => {
    const running = a2aResult({
      status: { state: 'TASK_STATE_RUNNING' },
      artifacts: [],
    })
    const completed = a2aResult()

    let callCount = 0
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        ok: true,
        json: async () => jsonRpcOk(callCount >= 3 ? completed : running),
      }
    })

    const result = await pollUntilTerminal('task-abc123', 30_000)
    expect(result.state).toBe('TASK_STATE_COMPLETED')
    expect(result.text).toBe('artifact-text')
    expect(callCount).toBeGreaterThanOrEqual(3)
  })

  it('returns last known state on timeout', async () => {
    const running = a2aResult({
      status: { state: 'TASK_STATE_RUNNING' },
      artifacts: [],
    })
    globalThis.fetch = mockFetchOk(running)

    const result = await pollUntilTerminal('task-abc123', 1_500)
    expect(result.state).toBe('TASK_STATE_RUNNING')
  }, 10_000)

  it('handles failure state from poll', async () => {
    const failed = a2aResult({
      status: {
        state: 'TASK_STATE_FAILED',
        message: { role: 'ROLE_AGENT', parts: [{ text: 'Something broke' }] },
      },
      artifacts: [],
    })
    globalThis.fetch = mockFetchOk(failed)

    const result = await pollUntilTerminal('task-abc123', 5_000)
    expect(result.state).toBe('TASK_STATE_FAILED')
    expect(result.text).toBe('Something broke')
  })
})
