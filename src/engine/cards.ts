export type Tier = 1 | 2 | 3 | 4 | 5
export type Kind = 'truth' | 'dare' | 'wild'

export interface Card {
  no: number
  tier: Tier
  kind: Kind
  text: string
}

export interface Deck {
  tierNames: Record<Tier, string>
  cards: Card[]
}

// 卡库格式（自己写牌就照这个改 src/cards/cards.zh.json）：
// { "tiers": {"1": "心动", ...}, "cards": [{"no": 101, "tier": 1, "kind": "truth", "text": "..."}] }
// - no：全局唯一编号，习惯上百位=档位，十位 0=真心话 / 1=大冒险 / 2=变数
// - 文案只写对执行者的祈使句或问题，不预写任何人的反应
export function loadDeck(source: unknown): Deck {
  const obj = source as { tiers?: Record<string, string>; cards?: Card[] }
  const tierNames = {} as Record<Tier, string>
  for (const t of [1, 2, 3, 4, 5] as Tier[]) {
    tierNames[t] = obj.tiers?.[String(t)] ?? `第 ${t} 档`
  }
  const seen = new Set<number>()
  const cards: Card[] = []
  for (const c of obj.cards ?? []) {
    if (!c || typeof c.text !== 'string' || !c.text.trim()) continue
    if (c.tier < 1 || c.tier > 5) continue
    if (c.kind !== 'truth' && c.kind !== 'dare' && c.kind !== 'wild') continue
    if (seen.has(c.no)) throw new Error(`duplicate card no ${c.no}`)
    seen.add(c.no)
    cards.push({ no: c.no, tier: c.tier as Tier, kind: c.kind, text: c.text.trim() })
  }
  return { tierNames, cards }
}
