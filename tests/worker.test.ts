import assert from 'node:assert/strict'
import test from 'node:test'

import type { GameState } from '../src/engine/game.ts'
import { callTool, handleRpc, parseRpc, roomOf, TOOLS, type TableStore } from '../worker/src/mcp.ts'

function memoryStore(): TableStore & { state: GameState | null } {
  const box = {
    state: null as GameState | null,
    async load() {
      return box.state
    },
    async save(s: GameState | null) {
      box.state = s
    },
  }
  return box
}

test('roomOf accepts only safe room ids', () => {
  assert.equal(roomOf({ arguments: { room: 'abc-123_X' } }), 'abc-123_X')
  assert.equal(roomOf({ arguments: { room: '  ok ' } }), 'ok')
  assert.equal(roomOf({ arguments: { room: 'no/slash' } }), null)
  assert.equal(roomOf({ arguments: {} }), null)
  assert.equal(roomOf(undefined), null)
})

test('initialize, ping, tools/list answer without a room', async () => {
  const init = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, null)
  assert.equal((init!.result as { protocolVersion: string }).protocolVersion, '2025-06-18')
  const ping = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'ping' }, null)
  assert.deepEqual(ping!.result, {})
  const list = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, null)
  assert.equal((list!.result as { tools: unknown[] }).tools.length, TOOLS.length)
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, null), null)
  const unknown = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'nope' }, null)
  assert.equal(unknown!.error!.code, -32601)
})

test('tools/call without a valid room is rejected; unknown tool is rejected', async () => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'state', arguments: {} } }, null)
  assert.equal(r!.error!.code, -32602)
  const u = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'wat', arguments: { room: 'x' } } }, memoryStore())
  assert.equal(u!.error!.code, -32602)
})

test('a full slow round through the tools', async () => {
  const store = memoryStore()
  let out = await callTool(store, 'state', {})
  assert.match(out.text, /还没开局/)
  out = await callTool(store, 'pick', { kind: 'truth' })
  assert.equal(out.isError, true)
  out = await callTool(store, 'new_game', { mode: 'slow', wild: false })
  assert.equal(store.state!.mode, 'slow')
  assert.equal(store.state!.wildEnabled, false)
  out = await callTool(store, 'pick', { kind: 'dare' })
  assert.equal(store.state!.currentCard!.kind, 'dare')
  assert.match(out.text, /桌上：#1\d\d/)
  out = await callTool(store, 'done', {})
  assert.equal(store.state!.turn, 'b')
  assert.match(out.text, /轮到 b 抽/)
  out = await callTool(store, 'pick', { kind: 'dare' })
  out = await callTool(store, 'skip', {})
  assert.equal(store.state!.nextTier, 2)
  out = await callTool(store, 'stop', {})
  assert.equal(store.state!.stopped, true)
  assert.match(out.text, /已停/)
})

test('duel: challenge, decree and accept via rpc with structuredContent', async () => {
  const store = memoryStore()
  await callTool(store, 'new_game', { mode: 'duel', wild: false })
  await callTool(store, 'pick', { kind: 'truth' })
  const res = await handleRpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'challenge', arguments: { room: 'r', verdict: 'uphold' } } }, store)
  const result = res!.result as { isError: boolean; structuredContent: { state: GameState } }
  assert.equal(result.isError, false)
  assert.equal(result.structuredContent.state.composure.a, 9)
  store.state = { ...store.state!, gameOver: true, winner: 'b', loser: 'a' }
  await callTool(store, 'set_decree', { text: '今晚听我的' })
  assert.equal(store.state!.decree!.text, '今晚听我的')
  const acc = await callTool(store, 'accept_decree', {})
  assert.equal(store.state!.decree!.accepted, true)
  assert.match(acc.text, /已领/)
})

test('parseRpc accepts single and batch, rejects junk', () => {
  assert.equal(parseRpc({ jsonrpc: '2.0', method: 'ping' })!.length, 1)
  assert.equal(parseRpc([{ jsonrpc: '2.0', method: 'ping' }, { jsonrpc: '2.0', method: 'ping' }])!.length, 2)
  assert.equal(parseRpc({ method: 'ping' }), null)
  assert.equal(parseRpc([]), null)
  assert.equal(parseRpc('x'), null)
})
