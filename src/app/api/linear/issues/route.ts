import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  fetchLinearIssues,
  resolveLinearTeamSlug,
  LINEAR_TEAMS,
} from '@/lib/linear'

export const dynamic = 'force-dynamic'

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || '50', 10)
  if (!Number.isFinite(parsed)) return 50
  return Math.min(Math.max(parsed, 1), 200)
}

/**
 * GET /api/linear/issues
 * Query params: team (ops-alerts | tolowa-studio | omit for both), limit (default 50, max 200)
 * Read-only window onto Linear. Does not persist issues.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const teamParam = searchParams.get('team')?.trim() || ''
    let teamId: string | undefined

    if (teamParam) {
      const slug = resolveLinearTeamSlug(teamParam)
      if (!slug) {
        return NextResponse.json(
          { error: 'Invalid team. Use "ops-alerts", "tolowa-studio", or omit for both.' },
          { status: 400 },
        )
      }
      teamId = LINEAR_TEAMS[slug].id
    }

    const limit = parseLimit(searchParams.get('limit'))
    const result = await fetchLinearIssues({ teamId, limit })

    const response = NextResponse.json({
      issues: result.issues,
      stale: result.stale,
      fetchedAt: result.fetchedAt,
    })
    response.headers.set('X-Linear-Cache', result.cache)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch Linear issues'
    logger.error({ err: error }, 'GET /api/linear/issues error')
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
