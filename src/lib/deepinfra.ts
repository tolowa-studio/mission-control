import { logger } from './logger'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getDeepInfraConfig() {
  return {
    apiKey: (process.env.DEEPINFRA_API_KEY || '').trim(),
    baseUrl: (process.env.DEEPINFRA_BASE_URL || 'https://api.deepinfra.com/v1/openai').replace(/\/$/, ''),
    model: (process.env.DEEPINFRA_MODEL || 'zai-org/GLM-5.3-Flash').trim(),
    timeoutMs: parseInt(process.env.DEEPINFRA_TIMEOUT_MS || '120000', 10) || 120_000,
  }
}

// ---------------------------------------------------------------------------
// Public result shape
// ---------------------------------------------------------------------------

export interface DeepInfraDispatchResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchToDeepInfra(
  prompt: string,
  opts?: { model?: string; timeoutMs?: number },
): Promise<DeepInfraDispatchResult> {
  const cfg = getDeepInfraConfig()
  const model = opts?.model ?? cfg.model
  const timeoutMs = opts?.timeoutMs ?? cfg.timeoutMs

  if (!cfg.apiKey) {
    throw new Error('DEEPINFRA_API_KEY is not configured')
  }

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`DeepInfra HTTP ${res.status}: ${errBody.substring(0, 500)}`)
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    model?: string
  }

  const text = data.choices?.[0]?.message?.content
  if (!text) {
    throw new Error('DeepInfra returned empty choices — no content in response')
  }

  const inputTokens = data.usage?.prompt_tokens ?? 0
  const outputTokens = data.usage?.completion_tokens ?? 0
  const resolvedModel = data.model ?? model

  logger.info(
    { model: resolvedModel, inputTokens, outputTokens },
    'DeepInfra dispatch complete',
  )

  return { text: text.trim(), model: resolvedModel, inputTokens, outputTokens }
}
