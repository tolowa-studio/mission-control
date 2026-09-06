// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchLinearIssues,
  getLinearConfig,
  resetLinearCache,
  LINEAR_TEAMS,
  LINEAR_GRAPHQL_URL,
} from '../linear'

const makeOkResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

function issueNode(overrides: Record<string, unknown> = {}) {
  return {
    identifier: 'OPS-101',
    title: 'Open ops alert',
    url: 'https://linear.app/tolowa/issue/OPS-101',
    state: { name: 'Todo', type: 'unstarted' },
    priority: 2,
    labels: { nodes: [{ name: 'incident' }] },
    createdAt: '2026-09-05T12:00:00.000Z',
    team: { id: LINEAR_TEAMS['ops-alerts'].id, name: 'Ops Alerts' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  resetLinearCache()
  process.env.LINEAR_API_KEY = 'lin_api_test_key'
})

afterEach(() => {
  resetLinearCache()
  vi.useRealTimers()
})

describe('getLinearConfig', () => {
  it('throws a clear error naming LINEAR_API_KEY when missing', () => {
    delete process.env.LINEAR_API_KEY
    expect(() => getLinearConfig()).toThrow('LINEAR_API_KEY is not set')
  })

  it('returns the env key when set', () => {
    expect(getLinearConfig().apiKey).toBe('lin_api_test_key')
  })
})

describe('fetchLinearIssues', () => {
  it('sends the raw API key with no Bearer prefix and filters open issues', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse({
      data: {
        ops: { nodes: [issueNode()] },
        tolowa: { nodes: [] },
      },
    }))
    vi.stubGlobal('fetch', mockFetch)

    const result = await fetchLinearIssues({ limit: 50 })
    expect(result.stale).toBe(false)
    expect(result.cache).toBe('miss')
    expect(result.issues[0]?.identifier).toBe('OPS-101')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(LINEAR_GRAPHQL_URL)
    expect(init.headers.Authorization).toBe('lin_api_test_key')
    expect(init.headers.Authorization).not.toMatch(/^Bearer /)

    const body = JSON.parse(init.body)
    expect(body.variables.opsFilter.state.type.nin).toEqual(['completed', 'canceled'])
    expect(body.variables.tolowaFilter.team.id.eq).toBe(LINEAR_TEAMS['tolowa-studio'].id)
  })

  it('returns cached data on a second call within 60s without re-hitting Linear', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeOkResponse({
      data: {
        ops: { nodes: [issueNode()] },
        tolowa: { nodes: [] },
      },
    }))
    vi.stubGlobal('fetch', mockFetch)

    const first = await fetchLinearIssues()
    const second = await fetchLinearIssues()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(first.cache).toBe('miss')
    expect(second.cache).toBe('hit')
    expect(second.stale).toBe(false)
    expect(second.fetchedAt).toBe(first.fetchedAt)
  })

  it('returns last good cache as stale when a fresh fetch fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'))
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse({
        data: {
          ops: { nodes: [issueNode()] },
          tolowa: { nodes: [] },
        },
      }))
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
    vi.stubGlobal('fetch', mockFetch)

    await fetchLinearIssues()
    vi.setSystemTime(new Date('2026-09-05T12:01:01.000Z'))
    const stale = await fetchLinearIssues()
    vi.useRealTimers()

    expect(stale.stale).toBe(true)
    expect(stale.cache).toBe('stale')
    expect(stale.issues[0]?.identifier).toBe('OPS-101')
  })

  it('throws the actual Linear error when there is no cache to fall back to', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })))
    await expect(fetchLinearIssues()).rejects.toThrow('Linear API error 401: nope')
  })

  it('throws GraphQL errors instead of returning partial data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeOkResponse({
      errors: [{ message: 'Argument type mismatch' }],
    })))
    await expect(fetchLinearIssues()).rejects.toThrow('Argument type mismatch')
  })
})
