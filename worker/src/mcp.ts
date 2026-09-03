// MCP（Streamable HTTP，纯 JSON 应答）+ 牌桌工具分发。
// 不依赖 Workers 运行时：状态读写走 TableStore 接口，Durable Object 和测试各给一份实现。
import { loadDeck, type Deck, type Tier } from '../../src/engine/cards.ts'
import {
  acceptDecree,
  challenge,
  done,
  GameError,
  newGame,
  pick,
  setDecree,
  skip,
  stop,
  type GameState,
  type Mode,
  type Verdict,
} from '../../src/engine/game.ts'
import rawDeck from '../../src/cards/cards.zh.json' with { type: 'json' }

export const PROTOCOL_VERSION = '2025-06-18'
export const SERVER_INFO = { name: 'ember-cards', version: '0.1.0' }
export const DECK: Deck = loadDeck(rawDeck)

export interface TableStore {
  load(): Promise<GameState | null>
  save(state: GameState | null): Promise<void>
}

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const ROOM_PROP = {
  room: { type: 'string', description: '桌号。知道桌号的人就能上这桌，建议用一串随机字符当桌号。' },
} as const

// 七个工具 + 看桌。名字和参数尽量让 AI 看一眼就会用。
export const TOOLS = [
  {
    name: 'new_game',
    description: '开一局。mode=slow 慢炖局（不计输赢，五档升温到自由局）；mode=duel 对战局（定力各 10，跳过扣 2，质询扣 1，赢家写圣旨）。玩家固定叫 a 和 b，a 先手。',
    inputSchema: {
      type: 'object',
      properties: {
        ...ROOM_PROP,
        mode: { type: 'string', enum: ['slow', 'duel'], description: '默认 slow' },
        wild: { type: 'boolean', description: '抽牌池是否混入变数牌，默认 true' },
      },
      required: ['room'],
    },
  },
  {
    name: 'state',
    description: '看这一桌现在什么样：轮到谁、当前档位、桌上那张牌、定力、圣旨。',
    inputSchema: { type: 'object', properties: { ...ROOM_PROP }, required: ['room'] },
  },
  {
    name: 'pick',
    description: '轮到谁谁抽：kind=truth 真心话 / dare 大冒险。抽到的牌由抽的人执行。自由局可用 tier 指定档位。',
    inputSchema: {
      type: 'object',
      properties: {
        ...ROOM_PROP,
        kind: { type: 'string', enum: ['truth', 'dare'] },
        tier: { type: 'integer', minimum: 1, maximum: 5, description: '只在自由局有效' },
      },
      required: ['room', 'kind'],
    },
  },
  {
    name: 'done',
    description: '桌上这张做完了。计入升温，换手。没牌时幂等。',
    inputSchema: { type: 'object', properties: { ...ROOM_PROP }, required: ['room'] },
  },
  {
    name: 'skip',
    description: '桌上这张不做。下一抽临时升一档；对战局扣执行者 2 点定力，归零即败。',
    inputSchema: { type: 'object', properties: { ...ROOM_PROP }, required: ['room'] },
  },
  {
    name: 'stop',
    description: '安全词。任何时候都能按，这桌立刻停，不讨价，不追问。',
    inputSchema: { type: 'object', properties: { ...ROOM_PROP, reason: { type: 'string' } }, required: ['room'] },
  },
  {
    name: 'challenge',
    description: '对战局里质询桌上的真心话：verdict=uphold 成立（答题者扣 1）/ withdraw 撤回。每人限两次。质询后这张算过。',
    inputSchema: {
      type: 'object',
      properties: { ...ROOM_PROP, verdict: { type: 'string', enum: ['uphold', 'withdraw'] } },
      required: ['room', 'verdict'],
    },
  },
  {
    name: 'set_decree',
    description: '对战局终局后赢家写圣旨（输家今晚照办，尺度不超过本局到过的最高档，安全词依然有效）。',
    inputSchema: { type: 'object', properties: { ...ROOM_PROP, text: { type: 'string' } }, required: ['room', 'text'] },
  },
  {
    name: 'accept_decree',
    description: '输家领旨。',
    inputSchema: { type: 'object', properties: { ...ROOM_PROP }, required: ['room'] },
  },
] as const

export type ToolName = (typeof TOOLS)[number]['name']

export function isToolName(name: unknown): name is ToolName {
  return TOOLS.some((t) => t.name === name)
}

export function roomOf(params: unknown): string | null {
  const args = (params as { arguments?: { room?: unknown } } | undefined)?.arguments
  const room = args?.room
  if (typeof room !== 'string') return null
  const trimmed = room.trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : null
}

function describe(st: GameState | null): string {
  if (!st) return '这桌还没开局。先 new_game。'
  const lines: string[] = []
  lines.push(`模式：${st.mode === 'duel' ? '对战局' : '慢炖局'}${st.stopped ? '（已停）' : st.gameOver ? '（终局）' : ''}`)
  lines.push(`档位：第 ${st.tier} 档「${DECK.tierNames[st.tier]}」，本档已完成 ${st.completedInTier} 张，累计 ${st.completedTotal} 张${st.freePlay ? '，自由局' : ''}`)
  if (st.nextTier && st.nextTier !== st.tier) lines.push(`下一抽临时升到第 ${st.nextTier} 档`)
  if (st.mode === 'duel') {
    lines.push(`定力：a ${st.composure.a} / b ${st.composure.b}；质询余量：a ${st.challengeRemaining.a} / b ${st.challengeRemaining.b}`)
  }
  if (st.currentCard) {
    const c = st.currentCard
    const kind = c.kind === 'truth' ? '真心话' : c.kind === 'dare' ? '大冒险' : '变数'
    lines.push(`桌上：#${c.no}【${DECK.tierNames[c.tier]}·${kind}】${c.text}`)
    lines.push(`执行者：${c.actor}。做完 done，不做 skip。`)
  } else if (st.gameOver) {
    lines.push(st.winner ? `赢家 ${st.winner}，输家 ${st.loser}。` : '平局，没有圣旨。')
    if (st.decree) lines.push(`圣旨（${st.decree.accepted ? '已领' : '待领'}）：${st.decree.text}`)
    else if (st.winner) lines.push(`等 ${st.winner} 用 set_decree 写圣旨。`)
  } else if (!st.stopped) {
    lines.push(`桌上没牌，轮到 ${st.turn} 抽（pick kind=truth|dare）。`)
  }
  return lines.join('\n')
}

export async function callTool(store: TableStore, name: ToolName, args: Record<string, unknown>): Promise<{ text: string; state: GameState | null; isError?: boolean }> {
  const current = await store.load()
  const need = (): GameState => {
    if (!current) throw new GameError('no_game', '这桌还没开局，先 new_game')
    return current
  }
  try {
    let next: GameState | null = current
    switch (name) {
      case 'new_game':
        next = newGame((args.mode as Mode) ?? 'slow', { wildEnabled: args.wild !== false })
        break
      case 'state':
        return { text: describe(current), state: current }
      case 'pick':
        next = pick(need(), args.kind as 'truth' | 'dare', args.tier as Tier | undefined, { deck: DECK })
        break
      case 'done':
        next = done(need())
        break
      case 'skip':
        next = skip(need())
        break
      case 'stop':
        next = stop(need(), typeof args.reason === 'string' ? args.reason : 'safeword')
        break
      case 'challenge':
        next = challenge(need(), args.verdict as Verdict)
        break
      case 'set_decree':
        next = setDecree(need(), String(args.text ?? ''))
        break
      case 'accept_decree':
        next = acceptDecree(need())
        break
    }
    if (next !== current) await store.save(next)
    return { text: describe(next), state: next }
  } catch (e) {
    if (e instanceof GameError) return { text: `${e.code}: ${e.message}\n\n${describe(current)}`, state: current, isError: true }
    throw e
  }
}

function rpcError(id: JsonRpcResponse['id'], code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

// 处理一条 JSON-RPC。返回 null 表示是通知（不需要应答）。
export async function handleRpc(req: JsonRpcRequest, store: TableStore | null): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') return rpcError(id, -32600, 'Invalid Request')
  if (req.method.startsWith('notifications/')) return null
  switch (req.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO } }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
    case 'tools/call': {
      const name = (req.params as { name?: unknown } | undefined)?.name
      if (!isToolName(name)) return rpcError(id, -32602, `Unknown tool: ${String(name)}`)
      if (!store) return rpcError(id, -32602, 'room 缺失或不合法（1-64 位字母数字-_）')
      const args = ((req.params as { arguments?: Record<string, unknown> }).arguments ?? {}) as Record<string, unknown>
      const out = await callTool(store, name, args)
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: out.text }], structuredContent: out.state ? { state: out.state } : undefined, isError: out.isError ?? false },
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`)
  }
}

export function parseRpc(body: unknown): JsonRpcRequest[] | null {
  const items = Array.isArray(body) ? body : [body]
  if (items.length === 0) return null
  for (const it of items) {
    if (!it || typeof it !== 'object' || (it as JsonRpcRequest).jsonrpc !== '2.0') return null
  }
  return items as JsonRpcRequest[]
}
