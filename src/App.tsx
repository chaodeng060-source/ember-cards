import { useEffect, useMemo, useState } from 'react'
import Table from './components/Table.tsx'
import { DEFAULT_DECK } from './engine/defaultDeck.ts'
import { mergeDecks, parseCustomCards } from './engine/cards.ts'
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
  type Player,
  type Verdict,
} from './engine/game.ts'
import type { Tier } from './engine/cards.ts'

const STORAGE_KEY = 'ember-cards:v1'

export interface Settings {
  names: Record<Player, string>
  wildEnabled: boolean
  // 安全词：你们自己的那个词。按下去就是真停，不讨价。
  safeword: string
  // 我们的牌：一行一张「档位 类型 文案」，混进抽牌池；分享=把这段文本发给对方粘贴。
  customCardsText: string
}

interface Persisted {
  settings: Settings
  game: GameState | null
}

const DEFAULT_SETTINGS: Settings = {
  names: { a: '甲', b: '乙' },
  wildEnabled: true,
  safeword: '停',
  customCardsText: '',
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { settings: DEFAULT_SETTINGS, game: null }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}), names: { ...DEFAULT_SETTINGS.names, ...(parsed.settings?.names ?? {}) } },
      game: parsed.game && parsed.game.version === 1 ? parsed.game : null,
    }
  } catch {
    return { settings: DEFAULT_SETTINGS, game: null }
  }
}

export default function App() {
  const [{ settings, game }, setPersisted] = useState<Persisted>(load)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const customParsed = useMemo(() => parseCustomCards(settings.customCardsText), [settings.customCardsText])
  const deck = useMemo(() => mergeDecks(DEFAULT_DECK, customParsed.cards), [customParsed])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, game }))
    } catch {
      // 存不下就存不下，牌局照玩
    }
  }, [settings, game])

  function setGame(next: GameState | null) {
    setPersisted((p) => ({ ...p, game: next }))
  }

  function setSettings(patch: Partial<Settings>) {
    setPersisted((p) => ({ ...p, settings: { ...p.settings, ...patch } }))
  }

  function run(fn: () => GameState | null) {
    try {
      setError(null)
      setGame(fn())
    } catch (e) {
      setError(e instanceof GameError ? e.message : '这一步没走成，再试一次')
    }
  }

  const actions = {
    newGame: (mode: Mode) => run(() => newGame(mode, { wildEnabled: settings.wildEnabled })),
    pick: (kind: 'truth' | 'dare', tier?: Tier) => run(() => (game ? pick(game, kind, tier, { deck }) : null)),
    done: () => run(() => (game ? done(game) : null)),
    skip: () => run(() => (game ? skip(game) : null)),
    stop: () => run(() => (game ? stop(game) : null)),
    challenge: (verdict: Verdict) => run(() => (game ? challenge(game, verdict) : null)),
    setDecree: (text: string) => run(() => (game ? setDecree(game, text) : null)),
    acceptDecree: () => run(() => (game ? acceptDecree(game) : null)),
    reset: () => run(() => null),
  }

  return (
    <div className="app">
      <Table
        game={game}
        deck={deck}
        settings={settings}
        error={error}
        actions={actions}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {settingsOpen && (
        <div className="sheet-backdrop" onClick={() => setSettingsOpen(false)}>
          <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); setSettingsOpen(false) }}>
            <h2>设置</h2>
            <label>
              甲的名字
              <input value={settings.names.a} maxLength={12} onChange={(e) => setSettings({ names: { ...settings.names, a: e.target.value } })} />
            </label>
            <label>
              乙的名字
              <input value={settings.names.b} maxLength={12} onChange={(e) => setSettings({ names: { ...settings.names, b: e.target.value } })} />
            </label>
            <label>
              安全词（按钮上显示的字）
              <input value={settings.safeword} maxLength={8} onChange={(e) => setSettings({ safeword: e.target.value })} />
            </label>
            <label className="row">
              <input type="checkbox" checked={settings.wildEnabled} onChange={(e) => setSettings({ wildEnabled: e.target.checked })} />
              抽牌池混入变数牌（下一局生效）
            </label>
            <label>
              我们的牌（一行一张：档位 类型 文案，立刻进抽牌池）
              <textarea
                value={settings.customCardsText}
                rows={5}
                placeholder={'例：\n3 大冒险 用嘴解开对方一颗扣子。\n5 真心话 今晚最想从哪一步开始？'}
                onChange={(e) => setSettings({ customCardsText: e.target.value })}
              />
            </label>
            <p className="hint">
              已识别 {customParsed.cards.length} 张{customParsed.skipped > 0 ? `，${customParsed.skipped} 行没看懂（格式：档位1-5 真心话/大冒险 文案）` : ''}。
              想分享给别人：全选这段文本发过去，对方粘贴进同一个框就行。
            </p>
            <button type="submit" className="btn btn-primary">好了</button>
          </form>
        </div>
      )}
    </div>
  )
}
