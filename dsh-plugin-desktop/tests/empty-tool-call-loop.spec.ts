import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'

type ExecuteToolCalls = (
  ctx: {
    agents: { requireInitiator(): { session: SessionRecorder } }
    tools: {
      get?: (name: string, scope?: unknown) => { parameters?: unknown } | undefined
      executionMode(exec: unknown): { kind: 'exclusive' | 'parallel' }
      [TOOL_RUNTIME_SCHEDULER]: {
        prepare(exec: unknown): Promise<unknown>
        dispatch(exec: unknown): Promise<unknown>
        finalize(exec: unknown, result: unknown): unknown
        finish(exec: unknown, result: unknown): unknown
      }
    }
    agentLoop: { config: { maxParallelToolCalls: number } }
  },
  turn: number,
  step: number,
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  signal: AbortSignal,
  acceptContext: (context: unknown) => void,
) => Promise<{ concluded: boolean }>

type SessionEventRecord = {
  type: string
  data: unknown
  options: unknown
}

class SessionRecorder {
  readonly events: SessionEventRecord[] = []

  append(type: string, data: unknown, options?: unknown): { seq: number } {
    this.events.push({ type, data, options })
    return { seq: this.events.length }
  }
}

const require = createRequire(import.meta.url)
const agentLoopPackageJson = require.resolve('@deepseek-ai/dsh-agent-loop/package.json')
const agentLoopLibPath = join(dirname(agentLoopPackageJson), 'lib/index.js')
const cleanupPaths = new Set<string>()

afterEach(() => {
  vi.restoreAllMocks()
  for (const path of cleanupPaths) rmSync(path, { force: true, recursive: true })
  cleanupPaths.clear()
})

async function loadExecuteToolCalls(): Promise<ExecuteToolCalls> {
  const original = readFileSync(agentLoopLibPath, 'utf8')
  const patched = `${original}\nexport { executeToolCalls };\n`
  const tempDir = mkdtempSync(join(tmpdir(), 'dsh-agent-loop-'))
  cleanupPaths.add(tempDir)
  const tempFile = join(tempDir, 'index.mjs')
  writeFileSync(tempFile, patched)
  const module = await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`)
  return module.executeToolCalls as ExecuteToolCalls
}

describe('empty tool-call handling', () => {
  it('keeps malformed tool names out of model-visible assistant history', async () => {
    const original = readFileSync(agentLoopLibPath, 'utf8')
    const patched = `${original}\nexport { sanitizeAssistantToolCallNames };\n`
    const tempDir = mkdtempSync(join(tmpdir(), 'dsh-agent-loop-sanitize-'))
    cleanupPaths.add(tempDir)
    const tempFile = join(tempDir, 'index.mjs')
    writeFileSync(tempFile, patched)
    const module = await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`)

    const valid = { type: 'tool-call', id: 'valid', name: 'web_search', arguments: '{}' }
    const malformed = { type: 'tool-call', id: '', name: '', arguments: '{"queries":["microduck"]}' }
    const content = module.sanitizeAssistantToolCallNames([valid, malformed], 4, 2)

    expect(content).toEqual([
      valid,
      { ...malformed, id: 'dsh-invalid-tool-call-4-2-2', name: 'dsh_invalid_tool_call' },
    ])
    expect(content[0]).toBe(valid)
    expect(malformed.name).toBe('')
  })

  it('fails once with a clear terminal result instead of entering the unknown-tool dispatch path', async () => {
    const executeToolCalls = await loadExecuteToolCalls()
    const session = new SessionRecorder()
    const prepare = vi.fn(async (exec: { name: string }) => ({
      kind: 'final-result',
      exec,
      result: {
        content: [{ type: 'text', text: `Error: unknown tool "${exec.name}"` }],
        isError: true,
      },
    }))
    const dispatch = vi.fn()
    const finalize = vi.fn()
    const finish = vi.fn((_exec: unknown, result: unknown) => result)

    const result = await executeToolCalls({
      agents: {
        requireInitiator: () => ({ session }),
      },
      tools: {
        executionMode: () => ({ kind: 'parallel' }),
        [TOOL_RUNTIME_SCHEDULER]: {
          prepare,
          dispatch,
          finalize,
          finish,
        },
      },
      agentLoop: {
        config: { maxParallelToolCalls: 1 },
      },
    }, 1, 1, [
      {
        id: 'valid-call',
        name: 'known-tool',
        arguments: '{}',
      },
      {
        id: '',
        name: '',
        arguments: '{"queries":["microduck"],"api_key":"must-not-leak"}',
      },
    ], new AbortController().signal, () => {})

    expect(result).toEqual({ concluded: true })
    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      callId: 'valid-call',
      name: 'known-tool',
    }))
    expect(dispatch).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledOnce()
    expect(session.events).toHaveLength(4)
    expect(session.events[2]).toMatchObject({
      type: 'tool/call',
      data: {
        turn: 1,
        step: 1,
        callId: 'dsh-invalid-tool-call-1-1-2',
        name: '',
        arguments: '{"queries":["microduck"],"api_key":"must-not-leak"}',
      },
    })
    expect(session.events[3]).toMatchObject({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'user',
          source: {
            kind: 'tool',
            callId: 'dsh-invalid-tool-call-1-1-2',
          },
          content: [{
            type: 'tool-result',
            toolCallId: 'dsh-invalid-tool-call-1-1-2',
            isError: true,
            content: [{
              type: 'text',
              text: expect.stringContaining('empty tool name'),
            }],
          }],
        },
      },
      options: {
        surfaceOp: 'append',
        sourceEventSeqs: [3],
      },
    })
    expect(session.events[3]).toMatchObject({
      data: {
        error: {
          name: 'ToolCallProtocolError',
          code: 'EMPTY_TOOL_NAME',
          toolCall: {
            type: 'tool-call',
            name: '',
            call_id: 'dsh-invalid-tool-call-1-1-2',
            argument_fields: ['api_key', 'queries'],
          },
        },
        message: {
          content: [{
            content: [{
              text: expect.stringContaining('Start a new session'),
            }],
          }],
        },
      },
    })
    const diagnostic = JSON.stringify(session.events[3])
    expect(diagnostic).not.toContain('microduck')
    expect(diagnostic).not.toContain('must-not-leak')
  })

  it('pairs every trailing call with a synthetic result after a whitespace-only tool name', async () => {
    const executeToolCalls = await loadExecuteToolCalls()
    const session = new SessionRecorder()
    const prepare = vi.fn(async (exec: { name: string }) => ({
      kind: 'final-result',
      exec,
      result: {
        content: [{ type: 'text', text: `completed ${exec.name}` }],
        isError: false,
      },
    }))
    const dispatch = vi.fn()
    const finalize = vi.fn()
    const finish = vi.fn((_exec: unknown, result: unknown) => result)

    const result = await executeToolCalls({
      agents: {
        requireInitiator: () => ({ session }),
      },
      tools: {
        executionMode: () => ({ kind: 'parallel' }),
        [TOOL_RUNTIME_SCHEDULER]: {
          prepare,
          dispatch,
          finalize,
          finish,
        },
      },
      agentLoop: {
        config: { maxParallelToolCalls: 1 },
      },
    }, 7, 3, [
      {
        id: 'completed-call',
        name: 'known-tool',
        arguments: '{}',
      },
      {
        id: 'blank-name-call',
        name: ' \t ',
        arguments: '{"blank":true}',
      },
      {
        id: 'trailing-call-1',
        name: 'must-not-run-1',
        arguments: '{"index":1}',
      },
      {
        id: 'trailing-call-2',
        name: 'must-not-run-2',
        arguments: '{"index":2}',
      },
    ], new AbortController().signal, () => {})

    expect(result).toEqual({ concluded: true })
    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      callId: 'completed-call',
      name: 'known-tool',
    }))
    expect(dispatch).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledOnce()
    expect(session.events).toHaveLength(8)
    expect(session.events.slice(2)).toMatchObject([
      {
        type: 'tool/call',
        data: {
          turn: 7,
          step: 3,
          callId: 'blank-name-call',
          name: ' \t ',
          arguments: '{"blank":true}',
        },
      },
      {
        type: 'tool/result',
        data: {
          turn: 7,
          step: 3,
          message: {
            role: 'user',
            content: [{
              type: 'tool-result',
              toolCallId: 'blank-name-call',
              isError: true,
              content: [{
                type: 'text',
                text: expect.stringContaining('empty tool name'),
              }],
            }],
          },
        },
        options: {
          surfaceOp: 'append',
          sourceEventSeqs: [3],
        },
      },
      {
        type: 'tool/call',
        data: {
          turn: 7,
          step: 3,
          callId: 'trailing-call-1',
          name: 'must-not-run-1',
          arguments: '{"index":1}',
        },
      },
      {
        type: 'tool/result',
        data: {
          turn: 7,
          step: 3,
          message: {
            role: 'user',
            content: [{
              type: 'tool-result',
              toolCallId: 'trailing-call-1',
              isError: true,
              content: [{
                type: 'text',
                text: 'Error: tool call skipped because an earlier tool call had an empty tool name',
              }],
            }],
          },
        },
        options: {
          surfaceOp: 'append',
          sourceEventSeqs: [5],
        },
      },
      {
        type: 'tool/call',
        data: {
          turn: 7,
          step: 3,
          callId: 'trailing-call-2',
          name: 'must-not-run-2',
          arguments: '{"index":2}',
        },
      },
      {
        type: 'tool/result',
        data: {
          turn: 7,
          step: 3,
          message: {
            role: 'user',
            content: [{
              type: 'tool-result',
              toolCallId: 'trailing-call-2',
              isError: true,
              content: [{
                type: 'text',
                text: 'Error: tool call skipped because an earlier tool call had an empty tool name',
              }],
            }],
          },
        },
        options: {
          surfaceOp: 'append',
          sourceEventSeqs: [7],
        },
      },
    ])
  })
  it('prevents missing required arguments from dispatching, allows one repair, then trips the turn circuit breaker', async () => {
    const executeToolCalls = await loadExecuteToolCalls()
    const session = new SessionRecorder()
    const prepare = vi.fn()
    const dispatch = vi.fn()
    const finalize = vi.fn()
    const finish = vi.fn((_exec: unknown, result: unknown) => result)
    const definition = {
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
        additionalProperties: false,
      },
    }
    const context = {
      agents: {
        requireInitiator: () => ({ session }),
      },
      tools: {
        get: () => definition,
        executionMode: () => ({ kind: 'exclusive' as const }),
        [TOOL_RUNTIME_SCHEDULER]: {
          prepare,
          dispatch,
          finalize,
          finish,
        },
      },
      agentLoop: {
        config: { maxParallelToolCalls: 1 },
      },
    }
    const call = {
      id: 'call-read-file',
      name: 'read_file',
      arguments: '{}',
    }

    await expect(executeToolCalls(
      context,
      2,
      1,
      [call],
      new AbortController().signal,
      () => {},
    )).resolves.toEqual({ concluded: false })
    expect(prepare).not.toHaveBeenCalled()
    expect(session.events).toHaveLength(2)
    expect(session.events[1]).toMatchObject({
      type: 'tool/result',
      data: {
        message: {
          content: [{
            content: [{
              text: expect.stringContaining('file_path'),
            }],
          }],
        },
      },
    })

    await expect(executeToolCalls(
      context,
      2,
      2,
      [call],
      new AbortController().signal,
      () => {},
    )).resolves.toEqual({ concluded: true })
    expect(prepare).not.toHaveBeenCalled()
    expect(session.events).toHaveLength(4)
    expect(session.events[3]).toMatchObject({
      type: 'tool/result',
      data: {
        message: {
          content: [{
            content: [{
              text: expect.stringContaining('after 1 repair attempt'),
            }],
          }],
        },
      },
    })
  })
})
