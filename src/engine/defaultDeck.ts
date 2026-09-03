// 浏览器入口加载默认卡库；引擎测试不走这里（Node 直接 import JSON 要带 import attributes）。
import raw from '../cards/cards.zh.json'
import { loadDeck, type Deck } from './cards.ts'
import { setDefaultDeck } from './game.ts'

export const DEFAULT_DECK: Deck = loadDeck(raw)
setDefaultDeck(DEFAULT_DECK)
