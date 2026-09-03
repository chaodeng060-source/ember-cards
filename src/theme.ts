import type { Tier } from './engine/cards.ts'

export interface TierTheme {
  tier: Tier
  background: string
  text: string
  border?: string
}

// 五档五组渐变：粉白光晕 → 蜜橙 → 玫紫 → 深紫酒红 → 黑底粉紫描花。
export const TIER_THEMES: readonly TierTheme[] = [
  { tier: 1, background: 'linear-gradient(160deg,#fff5f7 0%,#ffd9e3 55%,#ffb3c8 100%)', text: '#d4527a' },
  { tier: 2, background: 'linear-gradient(160deg,#ffe8d6 0%,#ffb99a 50%,#ff7e79 100%)', text: '#c23a4f' },
  { tier: 3, background: 'linear-gradient(160deg,#f6c6e0 0%,#d886c9 50%,#9f5bb5 100%)', text: '#6d2e86' },
  { tier: 4, background: 'linear-gradient(160deg,#5b2a5e 0%,#7a2b52 55%,#3d1030 100%)', text: '#f2a9c4' },
  { tier: 5, background: 'radial-gradient(circle at 30% 20%,#2b0f24 0%,#12060f 70%)', text: '#f5c2dc', border: '#e08bb8' },
]

export const CARD_BACK = '#12060f'
export const CARD_BACK_ACCENT = '#e08bb8'
export const DECREE_BACKGROUND = 'linear-gradient(140deg,#3a2a0e 0%,#1a1206 60%)'
export const DECREE_GOLD = '#f0c96a'

export function tierTheme(tier: Tier): TierTheme {
  return TIER_THEMES[tier - 1]
}
