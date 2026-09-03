import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../App.tsx'
import type { Deck, Tier } from '../engine/cards.ts'
import { kindLabel, type GameState, type Mode, type Player, type Verdict } from '../engine/game.ts'
import { CARD_BACK, CARD_BACK_ACCENT, DECREE_BACKGROUND, DECREE_GOLD, TIER_THEMES, tierTheme } from '../theme.ts'

const FLIP_MS = 620

export interface TableActions {
  newGame(mode: Mode): void
  pick(kind: 'truth' | 'dare', tier?: Tier): void
  done(): void
  skip(): void
  stop(): void
  challenge(verdict: Verdict): void
  setDecree(text: string): void
  acceptDecree(): void
  reset(): void
}

interface Props {
  game: GameState | null
  deck: Deck
  settings: Settings
  error: string | null
  actions: TableActions
  onOpenSettings(): void
}

export default function Table({ game, deck, settings, error, actions, onOpenSettings }: Props) {
  const [revealed, setRevealed] = useState(Boolean(game?.currentCard))
  const [busy, setBusy] = useState(false)
  const [decreeDraft, setDecreeDraft] = useState('')
  const [freeTier, setFreeTier] = useState<Tier | undefined>(undefined)
  const lastCardRef = useRef<number | null>(game?.currentCard?.no ?? null)

  // 桌上换牌 → 先翻回牌背再翻开；牌被收走 → 翻回牌背。
  useEffect(() => {
    const no = game?.currentCard?.no ?? null
    if (no === lastCardRef.current) return
    lastCardRef.current = no
    if (no === null) {
      setRevealed(false)
      return
    }
    setRevealed(false)
    setBusy(true)
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true)))
    const timer = window.setTimeout(() => setBusy(false), FLIP_MS + 40)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [game?.currentCard?.no])

  const name = (p: Player | null) => (p ? settings.names[p] || (p === 'a' ? '甲' : '乙') : '—')
  const stopLabel = settings.safeword.trim() || '停'

  if (!game || game.stopped) {
    return (
      <section className="table">
        <Header title={game?.stopped ? '这局停下了' : '这一局，想怎么玩？'} onOpenSettings={onOpenSettings} />
        <div className="mode-picker">
          <button type="button" className="mode-card" style={{ background: TIER_THEMES[0].background, color: TIER_THEMES[0].text, borderColor: TIER_THEMES[0].text }} onClick={() => actions.newGame('slow')}>
            <strong>慢炖局</strong>
            <span>不计输赢，顺着五档慢慢升温；第五档之后进入自由局。</span>
          </button>
          <button type="button" className="mode-card" style={{ background: TIER_THEMES[3].background, color: TIER_THEMES[3].text, borderColor: TIER_THEMES[3].text }} onClick={() => actions.newGame('duel')}>
            <strong>对战局</strong>
            <span>定力各 10，跳过和质询会扣；先归零的输，赢家写一道圣旨。</span>
          </button>
        </div>
        <p className="hint">{game?.stopped ? `刚才有人说了「${stopLabel}」。停下来先看人，牌什么时候再开都行。` : '安全词在桌角，随时能按，按了就是真停。'}</p>
      </section>
    )
  }

  const displayTier = game.currentCard?.tier ?? game.nextTier ?? game.tier
  const theme = tierTheme(displayTier)
  const cardTheme = tierTheme(game.currentCard?.tier ?? displayTier)
  const completionTarget = game.tier === 5 ? 4 : 2
  const card = game.currentCard
  const winnerName = name(game.winner)

  return (
    <section className="table" aria-busy={busy}>
      <button type="button" className="stop-btn" onClick={actions.stop} aria-label={`安全词：${stopLabel}，立刻停止`}>
        {stopLabel}
      </button>
      <Header
        title={`${game.mode === 'duel' ? '对战局' : '慢炖局'} · 轮到${name(game.turn)}`}
        onOpenSettings={onOpenSettings}
        onNewGame={actions.reset}
      />

      <div className="tiers" aria-label={`当前档位：${deck.tierNames[displayTier]}`}>
        {TIER_THEMES.map((t) => {
          const active = t.tier === displayTier
          return (
            <div key={t.tier} className={`tier ${active ? 'active' : ''}`}>
              <div className="tier-bar" style={{ background: t.background, boxShadow: active ? `0 0 16px ${t.text}` : 'none' }} />
              <span style={active ? { color: t.text } : undefined}>{deck.tierNames[t.tier]}</span>
            </div>
          )
        })}
      </div>
      <div className="progress">
        <span>
          {game.freePlay
            ? '自由局'
            : game.nextTier && game.nextTier !== game.tier
              ? `下一张临时升到 ${deck.tierNames[game.nextTier]}`
              : `本档 ${Math.min(game.completedInTier, completionTarget)}/${completionTarget}`}
        </span>
        <span>共完成 {game.completedTotal} 张</span>
      </div>

      {game.mode === 'duel' && (
        <div className="composure">
          {(['a', 'b'] as const).map((p) => (
            <div key={p}>
              <div className="composure-row">
                <span>{name(p)}</span>
                <span>定力 {game.composure[p]}/10</span>
              </div>
              <div className="composure-track">
                <div className="composure-fill" style={{ width: `${game.composure[p] * 10}%`, background: theme.background }} />
              </div>
              <small>质询余量 {game.challengeRemaining[p]}/2</small>
            </div>
          ))}
        </div>
      )}

      {game.gameOver ? (
        <div className="decree-panel">
          <article className="decree-card" style={{ background: DECREE_BACKGROUND, borderColor: DECREE_GOLD, color: DECREE_GOLD }}>
            <div className="decree-inner" style={{ borderColor: DECREE_GOLD }}>
              <header>
                <p className="eyebrow">终局</p>
                <p className="decree-title">圣旨</p>
              </header>
              <div className="decree-body">
                {game.winner ? (
                  <>
                    <p className="muted">赢家 · {winnerName}</p>
                    <p className="muted small">输家 · {name(game.loser)}</p>
                  </>
                ) : (
                  <p className="muted">平局，没有圣旨。</p>
                )}
                {game.decree ? (
                  <p className="decree-text">{game.decree.text}</p>
                ) : game.winner ? (
                  <div className="decree-form">
                    <label htmlFor="decree">{winnerName}写下今晚的一道要求</label>
                    <textarea id="decree" value={decreeDraft} maxLength={300} rows={4} onChange={(e) => setDecreeDraft(e.target.value)} placeholder="尺度不超过本局到过的最高档；安全词依然有效。" style={{ borderColor: DECREE_GOLD }} />
                    <button type="button" className="btn" style={{ borderColor: DECREE_GOLD, color: DECREE_GOLD }} disabled={!decreeDraft.trim()} onClick={() => actions.setDecree(decreeDraft)}>
                      颁下圣旨
                    </button>
                  </div>
                ) : null}
              </div>
              <footer className="eyebrow">最高到达 · {deck.tierNames[game.highestTier]}</footer>
            </div>
          </article>
          {game.decree && !game.decree.accepted && (
            <button type="button" className="btn btn-block" style={{ background: DECREE_BACKGROUND, borderColor: DECREE_GOLD, color: DECREE_GOLD }} onClick={actions.acceptDecree}>
              {name(game.loser)} 领旨
            </button>
          )}
          {game.decree?.accepted && <p className="hint" style={{ color: DECREE_GOLD }}>已领旨。今晚之内，尺度不超过本局到过的最高档，安全词依然有效。</p>}
          <button type="button" className="btn btn-block" onClick={actions.reset}>再来一局</button>
        </div>
      ) : (
        <>
          <div className="stage">
            <div className="stage-shadow" style={{ background: CARD_BACK, borderColor: CARD_BACK_ACCENT }} />
            <div className="flip" style={{ transform: revealed && card ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
              <div className="face back" style={{ background: CARD_BACK, borderColor: CARD_BACK_ACCENT, color: CARD_BACK_ACCENT }}>
                <div className="face-inner" style={{ borderColor: CARD_BACK_ACCENT }}>
                  <span className="rule" />
                  <div>
                    <p className="brand">Ember</p>
                    <p className="eyebrow">余温</p>
                  </div>
                  <span className="rule" />
                </div>
              </div>
              <article className="face front" style={{ background: cardTheme.background, borderColor: cardTheme.border ?? cardTheme.text, color: cardTheme.text }} aria-hidden={!revealed || !card}>
                <div className="face-inner" style={{ borderColor: cardTheme.border ?? cardTheme.text }}>
                  <header className="eyebrow">{card ? deck.tierNames[card.tier] : cardTheme.tier}</header>
                  <div className="card-body">
                    {card && (
                      <>
                        <p className="eyebrow">{kindLabel(card.kind)} · {name(card.actor)}执行</p>
                        <p className="card-text">{card.text}</p>
                      </>
                    )}
                  </div>
                  <footer className="eyebrow">Ember · 余温</footer>
                </div>
              </article>
            </div>
          </div>

          <div className="actions">
            {card ? (
              <>
                <div className="grid2">
                  <button type="button" className="btn" disabled={busy} onClick={actions.done}>完成</button>
                  <button type="button" className="btn btn-dark" disabled={busy} onClick={actions.skip}>跳过（升档）</button>
                </div>
                {game.mode === 'duel' && card.kind === 'truth' && (
                  <div className="challenge">
                    <div className="composure-row">
                      <span>{name(game.turn === card.actor ? (card.actor === 'a' ? 'b' : 'a') : game.turn)}可以质询这条真心话</span>
                      <span>余量 {game.challengeRemaining[card.actor === 'a' ? 'b' : 'a']}/2</span>
                    </div>
                    <div className="grid2">
                      <button type="button" className="btn small" disabled={busy || game.challengeRemaining[card.actor === 'a' ? 'b' : 'a'] <= 0} onClick={() => actions.challenge('uphold')}>质询成立（扣 1）</button>
                      <button type="button" className="btn small btn-dark" disabled={busy} onClick={() => actions.challenge('withdraw')}>撤回质询</button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {game.freePlay && (
                  <div className="free-tier">
                    <span>自由局，指定档位：</span>
                    {TIER_THEMES.map((t) => (
                      <button key={t.tier} type="button" className={`chip ${freeTier === t.tier ? 'on' : ''}`} style={{ background: t.background, color: t.text }} onClick={() => setFreeTier(freeTier === t.tier ? undefined : t.tier)}>
                        {deck.tierNames[t.tier]}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid2">
                  <button type="button" className="btn" disabled={busy} style={{ background: theme.background, color: theme.text, borderColor: theme.border ?? theme.text }} onClick={() => actions.pick('truth', freeTier)}>
                    真心话
                  </button>
                  <button type="button" className="btn btn-dark" disabled={busy} onClick={() => actions.pick('dare', freeTier)}>
                    大冒险
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <p className="hint" aria-live="polite">
        {error ? <span className="error">{error}</span> : card ? `${name(card.actor)}照着牌做；做完点完成，不想做点跳过，下一张会升一档。` : `轮到${name(game.turn)}选真心话还是大冒险。`}
      </p>
    </section>
  )
}

function Header({ title, onOpenSettings, onNewGame }: { title: string; onOpenSettings(): void; onNewGame?(): void }) {
  return (
    <div className="header">
      <div>
        <p className="eyebrow">Ember · 余温</p>
        <p className="title">{title}</p>
      </div>
      <div className="header-actions">
        {onNewGame && <button type="button" className="link" onClick={onNewGame}>新一局</button>}
        <button type="button" className="link" onClick={onOpenSettings}>设置</button>
      </div>
    </div>
  )
}
