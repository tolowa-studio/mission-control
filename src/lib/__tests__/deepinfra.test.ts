// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getDeepInfraConfig, dispatchToDeepInfra } from '../deepinfra'

const makeOkResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const makeErrorResponse = (status: number, body: string) =>
  new Response(body, { status })

beforeEach(() => {
  vi.restoreAllMocks()
  process.env.DEEPINFRA_API_KEY = 'test-key'
  delete process.env.DEEPINFRA_MODEL
  delete process.env.DEEPINFRA_BASE_URL
  delete process.env.DEEPINFRA_TIMEOUT_MS
})

describe('getDeepInfraConfig', () => {
  it('returns defaults when env vars are absent', () => {
    delete process.env.DEEPINFRA_API_KEY
    const cfg = getDeepInfraConfig()
    expect(cfg.baseUrl).toBe('https://api.deepinfra.com/v1/openai')
    expect(cfg.model).toBe('zai-org/GLM-5.3-Flash')
    expect(cfg.timeoutMs).toBe(120_000)
  })

  it('strips trailing slash from baseUrl', () => {
    process.env.DEEPINFRA_BASE_URL = 'https://custom.deepinfra.com/'
    expect(getDeepInfraConfig().baseUrl).toBe('https://custom.deepinfra.com')
  })
})

describe('dispatchToDeepInfra', () => {
  it('extracts text from choices[0].message.content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse({
      choices: [{ message: { content: 'Hello world' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: 'zai-org/GLM-5.3-Flash',
    })))

    const result = await dispatchToDeepInfra('ping')
    expect(result.text).toBe('Hello world')
  })

  it('extracts token usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 42, completion_tokens: 7 },
      model: 'zai-org/GLM-5.3-Flash',
    })))

    const result = await dispatchToDeepInfra('hi')
    expect(result.inputTokens).toBe(42)
    expect(result.outputTokens).toBe(7)
  })

  it('uses the default model when none is specified', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse({
      choices: [{ message: { content: 'done' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'zai-org/GLM-5.3-Flash',
    }))
    vi.stubGlobal('fetch', mockFetch)

    await dispatchToDeepInfra('prompt')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('zai-org/GLM-5.3-Flash')
  })

  it('throws on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeErrorResponse(401, 'Unauthorized')))

    await expect(dispatchToDeepInfra('x')).rejects.toThrow('DeepInfra HTTP 401')
  })

  it('throws when choices is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse({
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
      model: 'zai-org/GLM-5.3-Flash',
    })))

    await expect(dispatchToDeepInfra('x')).rejects.toThrow('empty choices')
  })

  it('throws when DEEPINFRA_API_KEY is missing', async () => {
    delete process.env.DEEPINFRA_API_KEY
    await expect(dispatchToDeepInfra('x')).rejects.toThrow('DEEPINFRA_API_KEY')
  })
})
