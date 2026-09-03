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

// —— 自定义牌 ——
// 玩家在设置里一行写一张：`档位 类型 文案`，类型认 真心话/大冒险/truth/dare。
// 例：`3 大冒险 用嘴解开对方一颗扣子。`
// 解析出的牌编号从 9001 起按行号排，只进本机牌池（localStorage），分享=把这段文本发给对方。
export interface ParsedCustomCards {
  cards: Card[]
  skipped: number
}

const KIND_WORDS: Record<string, 'truth' | 'dare'> = {
  truth: 'truth', 真心话: 'truth', 真心: 'truth',
  dare: 'dare', 大冒险: 'dare', 冒险: 'dare',
}

export function parseCustomCards(text: string): ParsedCustomCards {
  const cards: Card[] = []
  let skipped = 0
  const lines = (text ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const m = line.match(/^([1-5])[\s·|，,]*(\S+?)[\s·|，,]+(.+)$/)
    const kind = m ? KIND_WORDS[m[2]] : undefined
    if (!m || !kind || !m[3].trim()) {
      skipped++
      continue
    }
    cards.push({
      no: 9001 + i,
      tier: Number(m[1]) as Tier,
      kind,
      text: m[3].trim(),
    })
  }
  return { cards, skipped }
}

// 默认库 + 自定义牌合成本局牌池；自定义牌编号在 9000 段，天然不和默认库撞。
export function mergeDecks(base: Deck, extra: Card[]): Deck {
  if (!extra.length) return base
  return { tierNames: base.tierNames, cards: [...base.cards, ...extra] }
}
