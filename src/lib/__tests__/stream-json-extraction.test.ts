// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseStreamJsonResult } from '../task-dispatch'

describe('parseStreamJsonResult', () => {
  it('extracts result text from the last type=result NDJSON line', () => {
    const ndjson = [
      '{"type":"system","subtype":"init","tools":[{"name":"Read"},{"name":"Write"}]}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"thinking..."}]}}',
      '{"type":"result","subtype":"success","result":"ACKNOWLEDGED","session_id":"sess-123","cost_usd":0.001}',
    ].join('\n')

    const { resultText, sessionId } = parseStreamJsonResult(ndjson)
    expect(resultText).toBe('ACKNOWLEDGED')
    expect(sessionId).toBe('sess-123')
  })

  it('returns null when no type=result line exists', () => {
    const ndjson = [
      '{"type":"system","subtype":"init","tools":[]}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
    ].join('\n')

    const { resultText } = parseStreamJsonResult(ndjson)
    expect(resultText).toBeNull()
  })

  it('extracts usage from the result line', () => {
    const ndjson = [
      '{"type":"system","subtype":"init"}',
      '{"type":"result","result":"done","usage":{"input_tokens":100,"output_tokens":50}}',
    ].join('\n')

    const { resultText, usage } = parseStreamJsonResult(ndjson)
    expect(resultText).toBe('done')
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 50 })
  })

  it('skips malformed lines without crashing', () => {
    const ndjson = [
      '{"type":"system"}',
      'NOT VALID JSON AT ALL',
      '{"type":"result","result":"OK"}',
    ].join('\n')

    const { resultText } = parseStreamJsonResult(ndjson)
    expect(resultText).toBe('OK')
  })

  it('returns null for empty result field', () => {
    const ndjson = '{"type":"result","result":""}\n'
    const { resultText } = parseStreamJsonResult(ndjson)
    expect(resultText).toBeNull()
  })

  it('handles sessionId via sessionId field (camelCase)', () => {
    const ndjson = '{"type":"result","result":"hi","sessionId":"camel-123"}\n'
    const { sessionId } = parseStreamJsonResult(ndjson)
    expect(sessionId).toBe('camel-123')
  })

  it('handles realistic large stream-json with init blob', () => {
    const initBlob = JSON.stringify({
      type: 'system', subtype: 'init',
      tools: Array.from({ length: 50 }, (_, i) => ({ name: `tool_${i}`, description: `desc ${i}` })),
    })
    const ndjson = [
      initBlob,
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Let me work on this."}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"ACKNOWLEDGED"}]}}',
      '{"type":"result","subtype":"success","result":"ACKNOWLEDGED","session_id":"real-sess","cost_usd":0.003,"duration_ms":5432}',
    ].join('\n')

    const { resultText, sessionId } = parseStreamJsonResult(ndjson)
    expect(resultText).toBe('ACKNOWLEDGED')
    expect(sessionId).toBe('real-sess')
  })
})
