'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { apiFetch, ApiError } from '@/lib/api-client'
import { useSmartPoll } from '@/lib/use-smart-poll'

type TeamFilter = '' | 'ops-alerts' | 'tolowa-studio'

interface LinearIssue {
  identifier: string
  title: string
  url: string
  state: { name: string; type: string }
  priority: number
  labels: { name: string }[]
  createdAt: string
  team: { id: string; name: string }
}

interface LinearIssuesResponse {
  issues: LinearIssue[]
  stale: boolean
  fetchedAt: string
}

const OPS_TEAM_ID = 'b8b4a70b-769d-4e00-bbad-0807acfd3ac8'
const TOLOWA_TEAM_ID = '9d84ba75-0b82-4f0e-81b6-8078e1f0d5e4'
const POLL_MS = 60_000

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

function apiErrorMessage(err: unknown): string {
  if (
    err instanceof ApiError &&
    typeof err.payload === 'object' &&
    err.payload !== null &&
    'error' in err.payload &&
    typeof (err.payload as { error: unknown }).error === 'string'
  ) {
    return (err.payload as { error: string }).error
  }
  if (err instanceof Error && err.message) return err.message
  return 'Failed to fetch Linear issues'
}

function formatRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime()
  if (!Number.isFinite(timestamp)) return '—'
  const diffMs = Date.now() - timestamp
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function IssueRow({ issue }: { issue: LinearIssue }) {
  const priorityLabel = issue.priority > 0 ? PRIORITY_LABELS[issue.priority] : null

  return (
    <div className="bg-card rounded-lg p-3 border-l-2 border-border hover:bg-surface-1 transition-smooth">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs font-semibold text-primary hover:underline"
            >
              {issue.identifier}
            </a>
            <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">
              {issue.state.name}
            </span>
            {priorityLabel && (
              <span className="px-1.5 py-0.5 bg-orange-500/10 text-orange-400 rounded text-[10px]">
                {priorityLabel}
              </span>
            )}
          </div>
          <p className="text-sm text-foreground mt-1">{issue.title}</p>
          {issue.labels.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-2">
              {issue.labels.map((label) => (
                <span
                  key={label.name}
                  className="px-1.5 py-0.5 bg-surface-2 text-muted-foreground rounded text-[10px] border border-border/50"
                >
                  {label.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground/50">
          {formatRelativeTime(issue.createdAt)}
        </span>
      </div>
    </div>
  )
}

function TeamSection({
  title,
  subtitle,
  issues,
}: {
  title: string
  subtitle?: string
  issues: LinearIssue[]
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <span className="text-[10px] text-muted-foreground font-mono">{subtitle}</span>}
        <span className="flex-1 h-px bg-border" />
        <span className="text-2xs text-muted-foreground">{issues.length}</span>
      </div>
      {issues.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 px-1 py-2">No open issues</p>
      ) : (
        <div className="space-y-2">
          {issues.map((issue) => (
            <IssueRow key={issue.identifier} issue={issue} />
          ))}
        </div>
      )}
    </section>
  )
}

export function LinearIssuesPanel() {
  const [issues, setIssues] = useState<LinearIssue[]>([])
  const [stale, setStale] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('')

  const fetchIssues = useCallback(async () => {
    try {
      setError(null)
      const params = new URLSearchParams()
      if (teamFilter) params.set('team', teamFilter)
      params.set('limit', '50')
      const data = await apiFetch<LinearIssuesResponse>(`/api/linear/issues?${params}`)
      setIssues(data.issues || [])
      setStale(Boolean(data.stale))
      setFetchedAt(data.fetchedAt || null)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [teamFilter])

  useEffect(() => {
    void fetchIssues()
  }, [fetchIssues])

  useSmartPoll(fetchIssues, POLL_MS, { enabled: true })

  const opsIssues = useMemo(
    () => issues.filter((issue) => issue.team.id === OPS_TEAM_ID),
    [issues],
  )
  const tolowaIssues = useMemo(
    () => issues.filter((issue) => issue.team.id === TOLOWA_TEAM_ID),
    [issues],
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center p-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">Linear — read-only</h2>
          {stale && (
            <span className="px-1.5 py-0.5 bg-yellow-500/15 text-yellow-400 rounded text-[10px] font-medium">
              stale data
            </span>
          )}
        </div>
        <Button onClick={() => { setLoading(true); void fetchIssues() }} size="sm">
          Refresh
        </Button>
      </div>

      <div className="p-4 border-b border-border bg-surface-1 shrink-0">
        <label className="block text-xs text-muted-foreground mb-1">Team</label>
        <div className="flex gap-1 flex-wrap">
          <Button
            onClick={() => { setTeamFilter(''); setLoading(true) }}
            variant={teamFilter === '' ? 'default' : 'secondary'}
            size="xs"
          >
            Both
          </Button>
          <Button
            onClick={() => { setTeamFilter('ops-alerts'); setLoading(true) }}
            variant={teamFilter === 'ops-alerts' ? 'default' : 'secondary'}
            size="xs"
          >
            Ops Alerts
          </Button>
          <Button
            onClick={() => { setTeamFilter('tolowa-studio'); setLoading(true) }}
            variant={teamFilter === 'tolowa-studio' ? 'default' : 'secondary'}
            size="xs"
          >
            Tolowa Studio (TOL)
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Live view of Linear. Issues are not copied into Mission Control.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button
            onClick={() => setError(null)}
            variant="ghost"
            size="icon-sm"
            className="text-red-400/60 hover:text-red-400 ml-2"
          >
            x
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {loading && issues.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader variant="inline" label="Loading Linear issues" />
          </div>
        ) : teamFilter === 'ops-alerts' ? (
          <TeamSection title="Ops Alerts" issues={opsIssues} />
        ) : teamFilter === 'tolowa-studio' ? (
          <TeamSection title="Tolowa Studio" subtitle="TOL" issues={tolowaIssues} />
        ) : (
          <>
            <TeamSection title="Ops Alerts" issues={opsIssues} />
            <TeamSection title="Tolowa Studio" subtitle="TOL" issues={tolowaIssues} />
          </>
        )}
      </div>

      <div className="border-t border-border p-3 bg-surface-1 text-xs text-muted-foreground shrink-0">
        <div className="flex justify-between items-center">
          <span>
            {opsIssues.length} Ops Alerts · {tolowaIssues.length} Tolowa Studio
          </span>
          <span>
            {fetchedAt ? `Fetched ${new Date(fetchedAt).toLocaleTimeString()}` : 'Not yet fetched'}
          </span>
        </div>
      </div>
    </div>
  )
}
