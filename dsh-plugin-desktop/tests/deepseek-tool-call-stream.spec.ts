import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeepSeek Messages tool-call stream', () => {
  it('keeps the tool identity while later argument deltas omit it', async () => {
    const events = [{
      type: 'message_start',
      message: { usage: { input_tokens: 5, output_tokens: 0 } },
    }, {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'call-1',
        name: 'web_search',
        input: {},
      },
    }, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"queries":["microduck"]}' },
    }, {
      type: 'content_block_stop',
      index: 0,
    }, {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 10 },
    }, {
      type: 'message_stop',
    }]
    const sse = events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })))

    const connection = resolveAdapterOptions({
      baseURL: 'http://test',
      thinking: 'enabled',
      reasoningEffort: 'off',
    })
    const adapter = new DeepSeekAdapter({
      options: () => connection,
      resolveAuth: async () => ({ headers: { 'x-api-key': 'test-key' } }),
      resolveUserId: () => 'test-user' as unknown as AnonymousUserId,
      prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
    })

    const deltas: Array<{ name?: string; argumentsDelta: string }> = []
    const userMessage = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'search' }] })
    for await (const chunk of adapter.stream({
      provider: 'deepseek-official',
      model: 'qwen3.8-27b',
      messages: [userMessage],
      tools: [{
        name: 'web_search',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: { queries: { type: 'array' } },
          required: ['queries'],
        },
      }],
    })) {
      if (chunk.type === 'tool-call-delta') deltas.push(chunk)
    }

    expect(deltas).toEqual([
      { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'web_search', argumentsDelta: '' },
      { type: 'tool-call-delta', index: 0, id: 'call-1', argumentsDelta: '{"queries":["microduck"]}' },
    ])
  })
})
