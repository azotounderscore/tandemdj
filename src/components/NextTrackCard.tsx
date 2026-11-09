import { ArrowRight, FolderOpen, MonitorPlay, SlidersHorizontal, Sparkles } from 'lucide-react'
import { formatTime } from '../lib/format'
import { keysAreCompatible } from '../lib/keys'
import { activeSession, useMixerStore } from '../state/store'
import { Artwork } from './Artwork'
import { BpmValue, CamelotBadge } from './Badges'

export function NextTrackCard() {
  const mode = useMixerStore((state) => state.mode)
  const session = useMixerStore(activeSession)
  const setPanel = useMixerStore((state) => state.setPanel)
  const progress = useMixerStore(
    (state) =>
      state.analysisProgress[activeSession(state).tracks[activeSession(state).nextDeck]?.id ?? ''],
  )
  const current = session.tracks[session.currentDeck]
  const next = session.tracks[session.nextDeck]
  const currentAnalysis = current?.source === 'local' ? current.analysis : null
  const nextAnalysis = next?.source === 'local' ? next.analysis : null
  const compatibility = keysAreCompatible(
    currentAnalysis?.camelot ?? null,
    nextAnalysis?.camelot ?? null,
  )
  const openPicker = () => setPanel(mode === 'local' ? 'library' : 'youtube')

  if (!next) {
    return (
      <button type="button" className="next-track is-empty" onClick={openPicker}>
        <span className="next-empty-icon">
          {mode === 'local' ? <FolderOpen size={19} /> : <MonitorPlay size={19} />}
        </span>
        <span className="next-empty-copy">
          <span className="eyebrow">Prossimo · Deck {session.nextDeck}</span>
          <strong>
            {mode === 'local' ? 'Aggiungi il brano successivo' : 'Carica il prossimo video'}
          </strong>
          <span>
            {mode === 'local'
              ? 'Dal tuo dispositivo, con BPM e key analizzati in locale.'
              : 'Il player IFrame supporta solo la transizione in fade.'}
          </span>
        </span>
        <ArrowRight size={20} className="next-empty-arrow" />
      </button>
    )
  }

  return (
    <section className="next-track" aria-label="Prossimo brano">
      <span className="next-rail" aria-hidden="true">
        <ArrowRight size={16} />
      </span>
      <Artwork track={next} size="sm" />
      <div className="next-copy">
        <div className="next-kicker">
          <span className="eyebrow">Prossimo · Deck {session.nextDeck}</span>
          {session.playing[session.nextDeck] ? (
            <span className="playing-mini">
              <span className="playing-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              in play
            </span>
          ) : null}
          {compatibility === true ? (
            <span className="key-match">
              <Sparkles size={11} /> chiavi compatibili
            </span>
          ) : compatibility === false ? (
            <span className="key-mismatch">salto armonico</span>
          ) : null}
        </div>
        <strong className="next-title">{next.title}</strong>
        <span className="next-artist">{next.artist}</span>
        {progress ? (
          <span className="next-progress">
            {progress.stage} · {Math.round(progress.progress * 100)}%
          </span>
        ) : null}
      </div>
      <div className="next-stats">
        {next.source === 'local' ? (
          <>
            <BpmValue bpm={nextAnalysis?.bpm} />
            <CamelotBadge camelot={nextAnalysis?.camelot} />
          </>
        ) : (
          <span className="fade-only-chip">solo fade</span>
        )}
        <span className="next-duration">{formatTime(next.duration)}</span>
      </div>
      <div className="next-actions">
        <button type="button" className="ghost-button compact" onClick={openPicker}>
          {mode === 'local' ? <FolderOpen size={14} /> : <MonitorPlay size={14} />}
          Cambia
        </button>
        <button
          type="button"
          className="icon-button small"
          onClick={() => setPanel('controls')}
          aria-label="Controlli del prossimo deck"
        >
          <SlidersHorizontal size={16} strokeWidth={2.1} />
        </button>
      </div>
    </section>
  )
}
