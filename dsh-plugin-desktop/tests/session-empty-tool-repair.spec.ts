/** Regression coverage for sessions written before the empty tool identity guard. */
import { Context } from '@deepseek-ai/cordis'
import { expandAssistantStream } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const repairedId = 'dsh-invalid-tool-call-1-1-1'

function corruptSessionRows(id: string): readonly unknown[] {
  const rows = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-message',
          role: 'assistant',
          source: { kind: 'model', provider: 'sub2api', model: 'qwen3.8-27b' },
          content: [{ type: 'tool-call', id: '', name: '', arguments: '{}' }],
        },
        stream: [
          { type: 'chunk', time: 1_002, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
          {
            type: 'chunk',
            time: 1_003,
            chunk: { type: 'tool-call-delta', index: 0, id: '', name: '', argumentsDelta: '{}' },
          },
          {
            type: 'chunk',
            time: 1_004,
            chunk: { type: 'block-end', index: 0, block: { type: 'tool-call', id: '', name: '', arguments: '{}' } },
          },
          { type: 'chunk', time: 1_005, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
        ],
      },
    },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: '', name: '', arguments: '{}' } },
    {
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'tool-result-message',
          role: 'user',
          source: { kind: 'tool', callId: '' },
          content: [{
            type: 'tool-result',
            toolCallId: '',
            isError: true,
            content: [{ type: 'text', text: 'invalid tool call' }],
          }],
        },
      },
    },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ].map((row, seq) => ({ ...row, seq, time: 1_000 + seq }))
  return [
    {
      type: 'session',
      version: 3,
      id,
      createdAt: 1,
      isSeeded: false,
      delegationDepth: 0,
      agentPreset: 'ptc',
    },
    ...rows,
  ]
}

async function writeCorruptSession(root: string, id: string, compression: 'none' | 'zstd'): Promise<void> {
  const directory = join(root, '_no-cwd', id)
  const [header, ...events] = corruptSessionRows(id)
  const headerText = `${JSON.stringify(header)}\n`
  const bodyText = `${events.map(row => JSON.stringify(row)).join('\n')}\n`
  await mkdir(directory, { recursive: true })
  if (compression === 'none') {
    await writeFile(join(directory, 'session.v3.jsonl'), headerText + bodyText)
    return
  }
  const options = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
  await writeFile(join(directory, 'session.v3.jsonl.zstd'), Buffer.concat([
    zstdCompressSync(Buffer.from(headerText), options),
    zstdCompressSync(Buffer.from(bodyText), options),
  ]))
}

describe.each(['none', 'zstd'] as const)('empty tool identity recovery (%s)', (compression) => {
  it('opens the old session and keeps call/result identities paired', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-empty-tool-session-'))
    const id = SessionId(`empty-tool-${compression}`)
    const ctx = new Context()
    try {
      await writeCorruptSession(root, id, compression)
      await ctx.plugin(JsonlSessionPersistence, { root, compression })
      const handle = await ctx.sessionPersistence.open(id, 'read')
      try {
        const { events } = await handle.read()
        const assistant = events.find(event => event.type === 'assistant/message')
        const call = events.find(event => event.type === 'tool/call')
        const result = events.find(event => event.type === 'tool/result')

        expect(assistant?.data.message.content).toContainEqual({
          type: 'tool-call',
          id: repairedId,
          name: 'dsh_invalid_tool_call',
          arguments: '{}',
        })
        const chunks = assistant?.type === 'assistant/message'
          ? expandAssistantStream(assistant.data.stream).map(member => member.chunk)
          : []
        expect(chunks).toContainEqual({
          type: 'tool-call-delta',
          index: 0,
          id: repairedId,
          name: 'dsh_invalid_tool_call',
          argumentsDelta: '{}',
        })
        expect(chunks).toContainEqual({
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: repairedId,
            name: 'dsh_invalid_tool_call',
            arguments: '{}',
          },
        })
        expect(call?.data).toMatchObject({ callId: repairedId, name: 'dsh_invalid_tool_call' })
        expect(result?.data.message.source).toEqual({ kind: 'tool', callId: repairedId })
        expect(result?.data.message.content[0]).toMatchObject({ toolCallId: repairedId })
      } finally {
        await handle.close()
      }
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
