import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeepSeek OpenAI-compatible tool-call stream', () => {
  it('does not let a later empty function name erase the first non-empty name', async () => {
    const first = {
      id: 'completion-1',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{
            index: 0,
            id: 'call-1',
            type: 'function',
            function: { name: 'web_search', arguments: '' },
          }],
        },
        finish_reason: null,
      }],
    }
    const malformedFollowup = {
      id: 'completion-1',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            function: { name: '', arguments: '{"queries":["microduck"]}' },
          }],
        },
        finish_reason: null,
      }],
    }
    const sse = [first, malformedFollowup]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .concat('data: [DONE]\n\n')
      .join('')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })))

    const connection = resolveAdapterOptions({
      baseURL: 'http://test',
      apiKeyEnv: 'TEST',
      thinking: 'enabled',
      reasoningEffort: 'off',
    })
    const adapter = new DeepSeekAdapter({
      options: () => connection,
      resolveApiKey: async () => 'test-key',
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
      { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'web_search', argumentsDelta: '{"queries":["microduck"]}' },
    ])
  })
})
