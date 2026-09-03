import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { loadDeck, mergeDecks, parseCustomCards } from '../src/engine/cards.ts'
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
} from '../src/engine/game.ts'
import { cryptoRng } from '../src/engine/rng.ts'

const deck = loadDeck(JSON.parse(readFileSync(new URL('../src/cards/cards.zh.json', import.meta.url), 'utf8')))
const firstNonWild = { pick: <T,>(items: readonly T[]) => items.find((c) => (c as { kind: string }).kind !== 'wild') ?? items[0] }
const opts = { deck, rng: firstNonWild }

function forceCard(st: GameState, no: number): GameState {
  const card = deck.cards.find((c) => c.no === no)!
  return { ...st, currentCard: { ...card, actor: st.turn, pickedKind: 'dare' } }
}

test('deck has 100 cards across five tiers with no duplicate numbers', () => {
  assert.equal(deck.cards.length, 100)
  for (const t of [1, 2, 3, 4, 5] as const) {
    assert.ok(deck.cards.filter((c) => c.tier === t).length >= 10, `tier ${t}`)
    assert.ok(deck.tierNames[t])
  }
})

test('crypto rng only returns members of the pool', () => {
  const pool = [1, 2, 3, 4, 5]
  for (let i = 0; i < 200; i += 1) assert.ok(pool.includes(cryptoRng.pick(pool)))
})

test('pick draws from the current tier and the chosen kind; wild mixes only when enabled', () => {
  const off = newGame('slow', { wildEnabled: false })
  const kinds = new Set<string>()
  for (let i = 0; i < 60; i += 1) kinds.add(pick(off, 'dare', undefined, { deck }).currentCard!.kind)
  assert.deepEqual([...kinds], ['dare'])
  const on = newGame('slow', { wildEnabled: true })
  const mixed = new Set<string>()
  for (let i = 0; i < 200; i += 1) mixed.add(pick(on, 'dare', undefined, { deck }).currentCard!.kind)
  assert.deepEqual([...mixed].sort(), ['dare', 'wild'])
})

test('pick twice is rejected and done alternates turn; two cards raise a tier', () => {
  let st = pick(newGame('slow'), 'truth', undefined, opts)
  assert.throws(() => pick(st, 'truth', undefined, opts), (e: unknown) => (e as GameError).code === 'card_pending')
  st = done(st)
  assert.equal(st.turn, 'b')
  assert.equal(st.completedInTier, 1)
  st = done(pick(st, 'dare', undefined, opts))
  assert.equal(st.tier, 2)
  assert.equal(st.completedInTier, 0)
  assert.equal(st.completedTotal, 2)
  assert.equal(st.turn, 'a')
})

test('done with no card is idempotent', () => {
  const st = newGame('slow')
  assert.equal(done(st), st)
})

test('skip raises the next draw one tier temporarily and caps at five', () => {
  let st = skip(pick(newGame('slow'), 'truth', undefined, opts))
  assert.equal(st.nextTier, 2)
  assert.equal(st.tier, 1)
  assert.equal(st.turn, 'b')
  st = pick(st, 'dare', undefined, opts)
  assert.equal(st.currentCard!.tier, 2)
  assert.equal(st.nextTier, null)
  st = pick(done(st), 'truth', undefined, opts)
  assert.equal(st.currentCard!.tier, 1)
  const top = { ...newGame('slow'), tier: 5 as const }
  assert.equal(skip(pick(top, 'truth', undefined, opts)).nextTier, 5)
})

test('slow mode enters free play after four cards in tier five', () => {
  let st: GameState = { ...newGame('slow'), tier: 5 }
  for (let i = 0; i < 4; i += 1) st = done(pick(st, 'dare', undefined, opts))
  assert.equal(st.freePlay, true)
  assert.equal(st.gameOver, false)
  assert.equal(pick(st, 'truth', 2, opts).currentCard!.tier, 2)
})

test('wild again keeps the turn and jump5 goes to the top', () => {
  let st = done(forceCard(newGame('slow'), 122))
  assert.equal(st.turn, 'a')
  assert.equal(st.completedInTier, 1)
  st = done(forceCard({ ...st, tier: 4 }, 422))
  assert.equal(st.tier, 5)
  assert.equal(st.completedInTier, 0)
  assert.equal(st.completedTotal, 1)
})

test('duel: skip costs two composure and zero settles the game', () => {
  let st = newGame('duel')
  for (let i = 0; i < 4; i += 1) {
    st = skip(pick(st, 'dare', undefined, opts))
    st = done(pick(st, 'dare', undefined, opts))
  }
  assert.equal(st.composure.a, 2)
  st = skip(pick(st, 'dare', undefined, opts))
  assert.equal(st.composure.a, 0)
  assert.equal(st.gameOver, true)
  assert.equal(st.loser, 'a')
  assert.equal(st.winner, 'b')
})

test('duel: challenge only on truth, limited to two, uphold costs one', () => {
  let st = pick(newGame('duel'), 'dare', undefined, opts)
  assert.throws(() => challenge(st, 'uphold'), (e: unknown) => (e as GameError).code === 'not_truth')
  st = pick(done(st), 'truth', undefined, opts)
  st = challenge(st, 'uphold')
  assert.equal(st.composure.b, 9)
  assert.equal(st.challengeRemaining.a, 1)
  assert.equal(st.currentCard, null)
  assert.equal(st.turn, 'a')
  st = challenge(pick(done(pick(st, 'dare', undefined, opts)), 'truth', undefined, opts), 'withdraw')
  assert.equal(st.composure.b, 9)
  assert.equal(st.challengeRemaining.a, 0)
  const again = pick(done(pick(st, 'dare', undefined, opts)), 'truth', undefined, opts)
  assert.throws(() => challenge(again, 'uphold'), (e: unknown) => (e as GameError).code === 'no_challenge_left')
})

test('decree only after a winner, then accepted', () => {
  const st0 = newGame('duel')
  assert.throws(() => setDecree(st0, '今晚听我的'), (e: unknown) => (e as GameError).code === 'no_winner')
  let st: GameState = { ...st0, gameOver: true, winner: 'b', loser: 'a' }
  assert.throws(() => setDecree(st, '   '), (e: unknown) => (e as GameError).code === 'empty_decree')
  st = setDecree(st, '今晚听我的')
  assert.deepEqual(st.decree, { text: '今晚听我的', accepted: false, by: 'b' })
  assert.equal(acceptDecree(st).decree!.accepted, true)
})

test('stop is terminal and works from any state', () => {
  const st = stop(pick(newGame('duel'), 'dare', undefined, opts))
  assert.equal(st.stopped, true)
  assert.equal(st.currentCard, null)
  assert.throws(() => pick(st, 'truth', undefined, opts), (e: unknown) => (e as GameError).code === 'stopped')
  assert.equal(stop(newGame('slow')).stopped, true)
})

test('history records every step', () => {
  const st = done(pick(newGame('slow'), 'truth', undefined, opts))
  assert.deepEqual(st.history.map((h) => h.event), ['new', 'pick', 'done'])
})

test('parseCustomCards reads tier/kind/text lines and skips garbage', () => {
  const { cards, skipped } = parseCustomCards(
    '3 大冒险 用嘴解开对方一颗扣子。\n' +
    '\n' +
    '5 truth 今晚最想从哪一步开始？\n' +
    '9 大冒险 档位越界\n' +
    '2 胡说 类型不认识\n' +
    '1 真心话\n',
  )
  assert.equal(cards.length, 2)
  assert.equal(skipped, 3)
  assert.deepEqual(cards.map((c) => [c.tier, c.kind]), [[3, 'dare'], [5, 'truth']])
  assert.ok(cards.every((c) => c.no >= 9001))
})

test('custom cards join the draw pool via mergeDecks', () => {
  const { cards } = parseCustomCards('4 大冒险 只抽得到我这一张。')
  const merged = mergeDecks(deck, cards)
  assert.equal(merged.cards.length, deck.cards.length + 1)
  const onlyCustom = { pick: <T,>(items: readonly T[]) => items.find((c) => (c as { no: number }).no >= 9001) ?? items[0] }
  let st = newGame('slow')
  st = { ...st, tier: 4 as const }
  st = pick(st, 'dare', undefined, { deck: merged, rng: onlyCustom })
  assert.ok(st.currentCard && st.currentCard.no >= 9001)
  assert.equal(st.currentCard!.text, '只抽得到我这一张。')
})

test('mergeDecks with no extras returns the base deck untouched', () => {
  assert.equal(mergeDecks(deck, []), deck)
})
