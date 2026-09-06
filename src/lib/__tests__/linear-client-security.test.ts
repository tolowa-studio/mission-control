import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Linear issues client security contract', () => {
  it('routes Linear reads through the shared API client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/panels/linear-issues-panel.tsx'),
      'utf8',
    )

    expect(source).toContain("apiFetch<LinearIssuesResponse>(`/api/linear/issues?${params}`)")
    expect(source).not.toMatch(/fetch\([`'"]\/api\/linear/)
    expect(source).toContain('err instanceof ApiError')
    expect(source).toContain('Linear — read-only')
    expect(source).toContain('stale data')
  })
})
