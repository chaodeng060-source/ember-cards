// Ember 引擎：两个人轮流选「真心话 / 大冒险」，真随机抽一张，谁抽到谁执行。
//
// 规矩：
// - 五档升温：每完成 2 张升一档（跳过不计）；第 5 档完成 4 张 →
//   慢炖局进自由局（可指定档位抽）/ 对战局终局比分。
// - 跳过：本轮跳过，下一抽临时升一档（封顶 5）；对战局跳过扣 2 定力。
// - 对战局：定力各 10；质询成立扣被质询者 1，每人限 2 次；归零即败；
//   赢家写圣旨、输家领旨。
// - 安全词：stop() 在游戏外，任何时候都能按，按下即终局，不讨价。
// - 变数牌可开关；只有「加时」「加码」两张有机械效果，其余靠人执行。
import { type Card, type Deck, type Kind, type Tier } from './cards.ts'
import { cryptoRng, type Rng } from './rng.ts'

let defaultDeck: Deck | null = null

// 浏览器入口（defaultDeck.ts）在启动时装默认卡库；测试或自定义卡库走 opts.deck。
export function setDefaultDeck(deck: Deck): void {
  defaultDeck = deck
}

export type Player = 'a' | 'b'
export type Mode = 'slow' | 'duel'
export type Verdict = 'uphold' | 'withdraw'

export const START_COMPOSURE = 10
export const CHALLENGE_LIMIT = 2
export const SKIP_PENALTY = 2
export const CHALLENGE_PENALTY = 1
export const CARDS_PER_TIER = 2
export const FINAL_TIER_CARDS = 4
export const MAX_TIER: Tier = 5

// 变数牌的机械效果：again = 同一人再抽一张（不换手）；jump5 = 直接升到第 5 档，本张不占完成计数
export const WILD_EFFECTS: Record<number, 'again' | 'jump5'> = { 122: 'again', 422: 'jump5' }

export interface TableCard extends Card {
  actor: Player
  pickedKind: 'truth' | 'dare'
}

export interface GameState {
  version: 1
  mode: Mode
  tier: Tier
  nextTier: Tier | null
  completedInTier: number
  completedTotal: number
  turn: Player
  currentCard: TableCard | null
  freePlay: boolean
  stopped: boolean
  composure: Record<Player, number>
  challengeRemaining: Record<Player, number>
  gameOver: boolean
  winner: Player | null
  loser: Player | null
  highestTier: Tier
  decree: { text: string; accepted: boolean; by: Player } | null
  wildEnabled: boolean
  history: HistoryEntry[]
}

export interface HistoryEntry {
  at: string
  event: 'new' | 'pick' | 'done' | 'skip' | 'stop' | 'challenge' | 'decree' | 'accept_decree'
  actor?: Player
  no?: number
  detail?: string
}

export class GameError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface GameOptions {
  deck?: Deck
  rng?: Rng
  wildEnabled?: boolean
}

export function other(p: Player): Player {
  return p === 'a' ? 'b' : 'a'
}

export function newGame(mode: Mode, opts: GameOptions = {}): GameState {
  if (mode !== 'slow' && mode !== 'duel') throw new GameError('bad_mode', 'mode 只能是 slow 或 duel')
  return {
    version: 1,
    mode,
    tier: 1,
    nextTier: null,
    completedInTier: 0,
    completedTotal: 0,
    turn: 'a',
    currentCard: null,
    freePlay: false,
    stopped: false,
    composure: { a: START_COMPOSURE, b: START_COMPOSURE },
    challengeRemaining: { a: CHALLENGE_LIMIT, b: CHALLENGE_LIMIT },
    gameOver: false,
    winner: null,
    loser: null,
    highestTier: 1,
    decree: null,
    wildEnabled: opts.wildEnabled ?? true,
    history: [{ at: now(), event: 'new', detail: mode }],
  }
}

function now(): string {
  return new Date().toISOString()
}

function requireLive(st: GameState): void {
  if (st.stopped) throw new GameError('stopped', '这局已经停了')
  if (st.gameOver) throw new GameError('game_over', '这局已经结束')
}

function clone(st: GameState): GameState {
  return structuredClone(st)
}

export function pick(state: GameState, kind: 'truth' | 'dare', tier?: Tier, opts: GameOptions = {}): GameState {
  requireLive(state)
  if (kind !== 'truth' && kind !== 'dare') throw new GameError('bad_kind', 'kind 只能是 truth 或 dare')
  if (state.currentCard) throw new GameError('card_pending', '桌上还有一张没处理')
  const st = clone(state)
  const deck = opts.deck ?? defaultDeck
  if (!deck) throw new GameError('no_deck', '没有装卡库')
  const rng = opts.rng ?? cryptoRng
  let drawTier: Tier = st.nextTier ?? st.tier
  if (st.freePlay && tier) drawTier = tier
  drawTier = Math.max(1, Math.min(MAX_TIER, drawTier)) as Tier
  const base = deck.cards.filter((c) => c.tier === drawTier && c.kind === kind)
  const wilds = st.wildEnabled ? deck.cards.filter((c) => c.tier === drawTier && c.kind === 'wild') : []
  const pool = base.concat(wilds)
  if (pool.length === 0) throw new GameError('empty_pool', `第 ${drawTier} 档没有${kind === 'truth' ? '真心话' : '大冒险'}牌`)
  const card = rng.pick(pool)
  st.currentCard = { ...card, actor: st.turn, pickedKind: kind }
  st.nextTier = null
  st.highestTier = Math.max(st.highestTier, card.tier) as Tier
  st.history.push({ at: now(), event: 'pick', actor: st.turn, no: card.no, detail: kind })
  return st
}

function finishCard(st: GameState, counted = true): void {
  const card = st.currentCard
  if (!card) return
  const effect = card.kind === 'wild' ? WILD_EFFECTS[card.no] : undefined
  st.currentCard = null
  if (effect === 'jump5') {
    st.tier = MAX_TIER
    st.completedInTier = 0
    st.turn = other(st.turn)
    return
  }
  if (counted) {
    st.completedInTier += 1
    st.completedTotal += 1
  }
  if (st.tier < MAX_TIER && st.completedInTier >= CARDS_PER_TIER) {
    st.tier = (st.tier + 1) as Tier
    st.completedInTier = 0
  } else if (st.tier === MAX_TIER && st.completedInTier >= FINAL_TIER_CARDS && !st.freePlay) {
    if (st.mode === 'slow') st.freePlay = true
    else settle(st)
  }
  if (effect !== 'again') st.turn = other(st.turn)
}

function settle(st: GameState, loser?: Player): void {
  st.gameOver = true
  if (loser === undefined) {
    const { a, b } = st.composure
    if (a === b) {
      st.winner = null
      st.loser = null
      return
    }
    loser = a < b ? 'a' : 'b'
  }
  st.loser = loser
  st.winner = other(loser)
}

export function done(state: GameState): GameState {
  requireLive(state)
  if (!state.currentCard) return state // 幂等：没牌就原样返回
  const st = clone(state)
  const actor = st.currentCard!.actor
  const no = st.currentCard!.no
  finishCard(st)
  st.history.push({ at: now(), event: 'done', actor, no })
  return st
}

export function skip(state: GameState): GameState {
  requireLive(state)
  if (!state.currentCard) throw new GameError('no_card', '桌上没有牌')
  const st = clone(state)
  const actor = st.currentCard!.actor
  const no = st.currentCard!.no
  st.currentCard = null
  st.nextTier = Math.min(MAX_TIER, st.tier + 1) as Tier
  if (st.mode === 'duel') {
    st.composure[actor] = Math.max(0, st.composure[actor] - SKIP_PENALTY)
    if (st.composure[actor] === 0) settle(st, actor)
  }
  st.turn = other(actor)
  st.history.push({ at: now(), event: 'skip', actor, no })
  return st
}

// 安全词：游戏外，任何状态都能停。
export function stop(state: GameState, reason = 'safeword'): GameState {
  const st = clone(state)
  st.stopped = true
  st.currentCard = null
  st.history.push({ at: now(), event: 'stop', detail: reason })
  return st
}

export function challenge(state: GameState, verdict: Verdict): GameState {
  requireLive(state)
  if (state.mode !== 'duel') throw new GameError('not_duel', '慢炖局没有质询')
  if (verdict !== 'uphold' && verdict !== 'withdraw') throw new GameError('bad_verdict', 'verdict 只能是 uphold 或 withdraw')
  const card = state.currentCard
  if (!card) throw new GameError('no_card', '桌上没有牌可质询')
  if (card.kind !== 'truth') throw new GameError('not_truth', '只有真心话能质询')
  const actor = card.actor
  const challenger = other(actor)
  if (state.challengeRemaining[challenger] <= 0) throw new GameError('no_challenge_left', '质询次数用完了')
  const st = clone(state)
  st.challengeRemaining[challenger] -= 1
  if (verdict === 'uphold') st.composure[actor] = Math.max(0, st.composure[actor] - CHALLENGE_PENALTY)
  finishCard(st)
  if (st.composure[actor] === 0 && !st.gameOver) settle(st, actor)
  st.history.push({ at: now(), event: 'challenge', actor, no: card.no, detail: verdict })
  return st
}

export function setDecree(state: GameState, text: string): GameState {
  if (!state.gameOver || !state.winner) throw new GameError('no_winner', '还没分出赢家')
  const t = (text || '').trim()
  if (!t) throw new GameError('empty_decree', '圣旨不能是空的')
  if (t.length > 400) throw new GameError('decree_too_long', '圣旨太长了')
  const st = clone(state)
  st.decree = { text: t, accepted: false, by: state.winner }
  st.history.push({ at: now(), event: 'decree', actor: state.winner })
  return st
}

export function acceptDecree(state: GameState): GameState {
  if (!state.decree) throw new GameError('no_decree', '还没有圣旨')
  const st = clone(state)
  st.decree = { ...st.decree!, accepted: true }
  st.history.push({ at: now(), event: 'accept_decree', actor: state.loser ?? undefined })
  return st
}

export function kindLabel(kind: Kind): string {
  return kind === 'truth' ? '真心话' : kind === 'dare' ? '大冒险' : '变数'
}
