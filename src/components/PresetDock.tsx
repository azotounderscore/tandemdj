import {
  ArrowLeftRight,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Sparkles,
  TrendingUp,
  Waves,
} from 'lucide-react'
import { haptic } from '../lib/haptics'
import { formatTime } from '../lib/format'
import {
  cueDeck,
  getMixAvailability,
  setCrossfader,
  startMix,
  toggleDeckPlay,
} from '../state/controller'
import { activeSession, useMixerStore } from '../state/store'
import type { DeckId, TransitionPreset } from '../types'
import { useNow } from '../hooks/useNow'

const PRESETS = [
  { id: 'auto', label: 'Auto', Icon: Sparkles },
  { id: 'fade', label: 'Fade', Icon: Waves },
  { id: 'rise', label: 'Rise', Icon: TrendingUp },
  { id: 'custom', label: 'Custom', Icon: ArrowLeftRight },
] as const satisfies ReadonlyArray<{
  id: TransitionPreset
  label: string
  Icon: typeof Sparkles
}>

function MixProgress() {
  const session = useMixerStore(activeSession)
  const active = Boolean(session.transitionFrom)
  const now = useNow(active, 120)
  if (!active || !session.transitionFrom || !session.transitionTo) return null
  const startedAt = session.transitionStartedAt ?? now
  const endsAt = session.transitionEndsAt ?? now
  const total = Math.max(1, endsAt - startedAt)
  const progress = Math.min(1, Math.max(0, (now - startedAt) / total))
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000))

  return (
    <div className="mix-progress" role="status" aria-live="polite">
      <div className="mix-progress-track">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="mix-progress-label">
        <span>
          Mix {session.transitionFrom} <span aria-hidden="true">→</span> {session.transitionTo}
        </span>
        <span>{remaining > 0 ? `${formatTime(remaining)}` : 'fine'}</span>
      </div>
    </div>
  )
}

function DeckPlayButton({
  deck,
  compact = false,
  disabled = false,
}: {
  deck: DeckId
  compact?: boolean
  disabled?: boolean
}) {
  const session = useMixerStore(activeSession)
  const track = session.tracks[deck]
  const playing = session.playing[deck]
  const loading = session.loading[deck]
  const hasNext = Boolean(session.tracks[session.nextDeck])

  return (
    <button
      type="button"
      className={`deck-play${compact ? ' is-compact' : ''}${playing ? ' is-playing' : ''}`}
      onClick={() => {
        haptic(6)
        void toggleDeckPlay(deck)
      }}
      disabled={disabled || !track || (compact && !hasNext)}
      aria-label={`${playing ? 'Pausa' : 'Riproduci'} deck ${deck}`}
      title={`Deck ${deck}`}
    >
      <span className="deck-play-label">{deck}</span>
      <span className="deck-play-icon">
        {loading ? (
          <Loader2 size={compact ? 15 : 18} className="spin" />
        ) : playing ? (
          <Pause size={compact ? 15 : 18} fill="currentColor" />
        ) : (
          <Play size={compact ? 15 : 18} fill="currentColor" />
        )}
      </span>
    </button>
  )
}

export function PresetDock() {
  const mode = useMixerStore((state) => state.mode)
  const session = useMixerStore(activeSession)
  const localSession = useMixerStore((state) => state.localSession)
  const transition = useMixerStore((state) => state.transition)
  const setTransition = useMixerStore((state) => state.setTransition)
  const setPanel = useMixerStore((state) => state.setPanel)
  const transitionActive = Boolean(session.transitionFrom)
  const current = session.tracks[session.currentDeck]
  const next = session.tracks[session.nextDeck]
  const availability = getMixAvailability()
  const canMix =
    mode === 'local'
      ? Boolean(
          current &&
          next &&
          session.playing[session.currentDeck] &&
          localSession.buffersReady[session.nextDeck] &&
          !transitionActive,
        )
      : availability.canMix

  const choosePreset = (preset: TransitionPreset) => {
    if (transitionActive) return
    haptic(7)
    setTransition({ preset })
    if (preset === 'custom') {
      window.setTimeout(() => {
        document.getElementById('transition-panel')?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }, 40)
    }
  }

  return (
    <footer className="preset-dock" aria-label="Trasporto e preset">
      <MixProgress />
      <div className="dock-presets" role="group" aria-label="Preset transizione">
        <span className="dock-preset-label">Presets</span>
        <div className="preset-scroll">
          {PRESETS.map(({ id, label, Icon }) => (
            <button
              type="button"
              key={id}
              className={`preset-chip${transition.preset === id ? ' is-active' : ''}`}
              onClick={() => choosePreset(id)}
              aria-pressed={transition.preset === id}
              disabled={transitionActive}
            >
              <Icon size={14} strokeWidth={2.2} />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button dock-library"
          onClick={() => setPanel(mode === 'local' ? 'library' : 'youtube')}
          aria-label={mode === 'local' ? 'Apri libreria' : 'Apri YouTube'}
        >
          <FolderOpen size={20} strokeWidth={1.9} />
        </button>
      </div>

      <div className="dock-transport">
        <div className="transport-side">
          <DeckPlayButton deck={session.currentDeck} disabled={transitionActive} />
          <button
            type="button"
            className="cue-button"
            onClick={() => {
              haptic(5)
              cueDeck(session.currentDeck)
            }}
            disabled={!current || transitionActive}
            aria-label={`Cue deck ${session.currentDeck}`}
            title="Cue"
          >
            CUE
          </button>
        </div>

        <div className="crossfader-block">
          <div className="crossfader-labels" aria-hidden="true">
            <span className={session.crossfader < 0.12 ? 'is-hot' : ''}>{session.currentDeck}</span>
            <span className="crossfader-center" />
            <span className={session.crossfader > 0.88 ? 'is-hot' : ''}>{session.nextDeck}</span>
          </div>
          <input
            className="crossfader-input"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={session.crossfader}
            onChange={(event) => setCrossfader(Number(event.target.value))}
            disabled={transitionActive || !current || !next}
            aria-label="Crossfader"
          />
        </div>

        <div className="transport-side transport-side-right">
          <DeckPlayButton deck={session.nextDeck} compact disabled={transitionActive} />
          <button
            type="button"
            className="mix-button"
            onClick={() => {
              haptic([6, 22, 10])
              void startMix()
            }}
            disabled={!canMix}
            title={canMix ? 'Avvia transizione' : availability.reason}
            aria-label={canMix ? 'Avvia mix' : `Mix non disponibile: ${availability.reason}`}
          >
            <ArrowLeftRight size={17} strokeWidth={2.4} />
            <span>Mix</span>
          </button>
        </div>
      </div>
    </footer>
  )
}
