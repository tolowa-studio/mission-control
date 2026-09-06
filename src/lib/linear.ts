/**
 * Read-only Linear GraphQL client.
 *
 * Linear remains canonical for issues. This module fetches live data on each
 * cache miss and keeps a 60s in-memory cache only to avoid rate-limit hammering
 * — never a durable copy, never a write path.
 */
import { logger } from '@/lib/logger'

export const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
export const LINEAR_CACHE_TTL_MS = 60_000
export const LINEAR_FETCH_TIMEOUT_MS = 15_000

export const LINEAR_TEAMS = {
  'ops-alerts': {
    slug: 'ops-alerts',
    id: 'b8b4a70b-769d-4e00-bbad-0807acfd3ac8',
    name: 'Ops Alerts',
  },
  'tolowa-studio': {
    slug: 'tolowa-studio',
    id: '9d84ba75-0b82-4f0e-81b6-8078e1f0d5e4',
    name: 'Tolowa Studio',
  },
} as const

export type LinearTeamSlug = keyof typeof LINEAR_TEAMS

const OPEN_STATE_TYPE_NIN = ['completed', 'canceled'] as const

const ISSUE_FIELDS = `
  identifier
  title
  url
  state { name type }
  priority
  labels { nodes { name } }
  createdAt
  team { id name }
`

const SINGLE_TEAM_QUERY = `
  query MissionControlIssues($filter: IssueFilter, $first: Int) {
    issues(filter: $filter, first: $first) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
`

const BOTH_TEAMS_QUERY = `
  query MissionControlIssuesByTeam($opsFilter: IssueFilter, $tolowaFilter: IssueFilter, $first: Int) {
    ops: issues(filter: $opsFilter, first: $first) {
      nodes { ${ISSUE_FIELDS} }
    }
    tolowa: issues(filter: $tolowaFilter, first: $first) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
`

export interface LinearIssue {
  identifier: string
  title: string
  url: string
  state: { name: string; type: string }
  priority: number
  labels: { name: string }[]
  createdAt: string
  team: { id: string; name: string }
}

export type LinearCacheStatus = 'hit' | 'miss' | 'stale'

export interface LinearIssuesResult {
  issues: LinearIssue[]
  stale: boolean
  fetchedAt: string
  cache: LinearCacheStatus
}

export interface FetchLinearIssuesOpts {
  teamId?: string
  limit?: number
  /** Default true: exclude completed and canceled issues. */
  openOnly?: boolean
}

interface CacheEntry {
  data: LinearIssue[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<LinearIssuesResult>>()

export function getLinearConfig(): { apiKey: string } {
  const apiKey = (process.env.LINEAR_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is not set')
  }
  return { apiKey }
}

export function resetLinearCache(): void {
  cache.clear()
  inFlight.clear()
}

function cacheKey(opts: { teamId?: string; limit: number; openOnly: boolean }): string {
  return `${opts.teamId ?? 'all'}|${opts.limit}|${opts.openOnly ? 'open' : 'all-states'}`
}

function isLinearTeamSlug(value: string): value is LinearTeamSlug {
  return value in LINEAR_TEAMS
}

export function resolveLinearTeamSlug(slug: string): LinearTeamSlug | null {
  return isLinearTeamSlug(slug) ? slug : null
}

function teamFilter(teamId: string) {
  return { id: { eq: teamId } }
}

function issueFilter(teamId: string, openOnly: boolean) {
  return {
    team: teamFilter(teamId),
    ...(openOnly ? { state: { type: { nin: [...OPEN_STATE_TYPE_NIN] } } } : {}),
  }
}

interface LinearIssueNode {
  identifier?: unknown
  title?: unknown
  url?: unknown
  state?: { name?: unknown; type?: unknown } | null
  priority?: unknown
  labels?: { nodes?: Array<{ name?: unknown }> | null } | null
  createdAt?: unknown
  team?: { id?: unknown; name?: unknown } | null
}

function mapIssue(node: LinearIssueNode): LinearIssue | null {
  if (typeof node.identifier !== 'string' || typeof node.title !== 'string' || typeof node.url !== 'string') {
    return null
  }
  const labels = Array.isArray(node.labels?.nodes)
    ? node.labels.nodes
        .filter((label): label is { name: string } => typeof label?.name === 'string')
        .map((label) => ({ name: label.name }))
    : []

  return {
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    state: {
      name: typeof node.state?.name === 'string' ? node.state.name : 'Unknown',
      type: typeof node.state?.type === 'string' ? node.state.type : 'unknown',
    },
    priority: typeof node.priority === 'number' ? node.priority : 0,
    labels,
    createdAt: typeof node.createdAt === 'string' ? node.createdAt : new Date(0).toISOString(),
    team: {
      id: typeof node.team?.id === 'string' ? node.team.id : '',
      name: typeof node.team?.name === 'string' ? node.team.name : 'Unknown',
    },
  }
}

function mapNodes(nodes: unknown): LinearIssue[] {
  if (!Array.isArray(nodes)) return []
  return nodes
    .map((node) => mapIssue(node as LinearIssueNode))
    .filter((issue): issue is LinearIssue => issue !== null)
}

class LinearApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinearApiError'
  }
}

interface GraphQLError {
  message?: unknown
}

async function linearGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const { apiKey } = getLinearConfig()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), LINEAR_FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed'
    throw new LinearApiError(`Linear API network failure: ${message}`)
  } finally {
    clearTimeout(timeout)
  }

  const raw = await response.text()
  if (!response.ok) {
    throw new LinearApiError(`Linear API error ${response.status}: ${raw || response.statusText}`)
  }

  let json: { data?: T; errors?: GraphQLError[] }
  try {
    json = JSON.parse(raw) as { data?: T; errors?: GraphQLError[] }
  } catch {
    throw new LinearApiError(`Linear API returned non-JSON: ${raw.slice(0, 300)}`)
  }

  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const message = json.errors
      .map((err) => (typeof err.message === 'string' ? err.message : 'Unknown GraphQL error'))
      .join('; ')
    throw new LinearApiError(message)
  }

  if (!json.data) {
    throw new LinearApiError('Linear API returned no data')
  }

  return json.data
}

async function fetchFromLinear(opts: { teamId?: string; limit: number; openOnly: boolean }): Promise<LinearIssue[]> {
  if (opts.teamId) {
    const data = await linearGraphql<{ issues?: { nodes?: unknown } }>(SINGLE_TEAM_QUERY, {
      filter: issueFilter(opts.teamId, opts.openOnly),
      first: opts.limit,
    })
    return mapNodes(data.issues?.nodes)
  }

  const data = await linearGraphql<{
    ops?: { nodes?: unknown }
    tolowa?: { nodes?: unknown }
  }>(BOTH_TEAMS_QUERY, {
    opsFilter: issueFilter(LINEAR_TEAMS['ops-alerts'].id, opts.openOnly),
    tolowaFilter: issueFilter(LINEAR_TEAMS['tolowa-studio'].id, opts.openOnly),
    first: opts.limit,
  })

  return [...mapNodes(data.ops?.nodes), ...mapNodes(data.tolowa?.nodes)]
}

function toResult(entry: CacheEntry, cacheStatus: LinearCacheStatus): LinearIssuesResult {
  return {
    issues: entry.data,
    stale: cacheStatus === 'stale',
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    cache: cacheStatus,
  }
}

async function loadIssues(opts: { teamId?: string; limit: number; openOnly: boolean }): Promise<LinearIssuesResult> {
  const key = cacheKey(opts)
  const now = Date.now()
  const existing = cache.get(key)
  if (existing && now - existing.fetchedAt < LINEAR_CACHE_TTL_MS) {
    const ageMs = now - existing.fetchedAt
    logger.info({ cache: 'hit', key, ageMs }, 'linear issues')
    return toResult(existing, 'hit')
  }

  try {
    logger.info({ cache: 'miss', key }, 'linear issues')
    const issues = await fetchFromLinear(opts)
    const entry: CacheEntry = { data: issues, fetchedAt: Date.now() }
    cache.set(key, entry)
    return toResult(entry, 'miss')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Linear error'
    if (existing) {
      logger.warn({ cache: 'stale-fallback', key, err: message }, 'linear issues')
      return toResult(existing, 'stale')
    }
    throw error instanceof LinearApiError ? error : new LinearApiError(message)
  }
}

export async function fetchLinearIssues(opts: FetchLinearIssuesOpts = {}): Promise<LinearIssuesResult> {
  const limit = typeof opts.limit === 'number' && Number.isFinite(opts.limit)
    ? Math.min(Math.max(Math.trunc(opts.limit), 1), 200)
    : 50
  const openOnly = opts.openOnly !== false
  const teamId = opts.teamId?.trim() || undefined
  const normalized = { teamId, limit, openOnly }
  const key = cacheKey(normalized)

  const pending = inFlight.get(key)
  if (pending) return pending

  const promise = loadIssues(normalized).finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}
