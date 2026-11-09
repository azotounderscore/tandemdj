import { FolderOpen, Loader2, MonitorPlay, SlidersHorizontal } from 'lucide-react'
import { formatTime } from '../lib/format'
import { useDeckClock } from '../hooks/useDeckClock'
import { activeSession, useMixerStore } from '../state/store'
import { Artwork } from './Artwork'
import { BpmValue, CamelotBadge, SourceBadge } from './Badges'

export function TrackHeader() {
  const mode = useMixerStore((state) => state.mode)
  const session = useMixerStore(activeSession)
  const progress = useMixerStore(
    (state) =>
      state.analysisProgress[
        activeSession(state).tracks[activeSession(state).currentDeck]?.id ?? ''
      ],
  )
  const setPanel = useMixerStore((state) => state.setPanel)
  const track = session.tracks[session.currentDeck]
  const loading = session.loading[session.currentDeck]
  const playing = session.playing[session.currentDeck]
  const clock = useDeckClock(mode, session.currentDeck, track?.duration ?? 0, 180)
  const analysis = track?.source === 'local' ? track.analysis : null
  const statusLabel = track ? (playing ? 'In riproduzione' : 'In pausa') : 'Deck libero'

  const openSource = () => setPanel(mode === 'local' ? 'library' : 'youtube')

  return (
    <section className="track-header" aria-label="Deck corrente">
      <Artwork track={track} size="lg" />
      <div className="track-heading">
        <div className="track-kicker">
          <span className={`live-dot${playing ? ' is-playing' : ' is-idle'}`} aria-hidden="true" />
          <span>{statusLabel}</span>
          <span className="kicker-divider" aria-hidden="true" />
          <span>Deck {session.currentDeck}</span>
          {track ? <SourceBadge source={track.source} /> : null}
          {loading ? (
            <span className="inline-loading">
              <Loader2 size={12} className="spin" /> carico
            </span>
          ) : null}
        </div>
        <h1 className={track ? '' : 'is-empty'}>
          {track?.title ?? 'Il tuo prossimo mix parte qui'}
        </h1>
        <p className="track-artist">
          {track?.artist ??
            (mode === 'local'
              ? 'Importa due file audio. Restano sul dispositivo.'
              : 'Carica due video e mixa con il player ufficiale.')}
        </p>
        {progress ? (
          <div className="analysis-inline" role="status">
            <span className="analysis-bar">
              <span style={{ width: `${Math.round(progress.progress * 100)}%` }} />
            </span>
            <span>
              {progress.stage} · {Math.round(progress.progress * 100)}%
            </span>
          </div>
        ) : null}
        {!track ? (
          <button type="button" className="inline-cta" onClick={openSource}>
            {mode === 'local' ? <FolderOpen size={15} /> : <MonitorPlay size={15} />}
            {mode === 'local' ? 'Importa audio' : 'Apri YouTube'}
          </button>
        ) : null}
      </div>

      <div className="track-side">
        <div className="track-stats">
          {mode === 'local' ? (
            <>
              <div className="stat-block">
                <span className="stat-label">BPM</span>
                <BpmValue bpm={analysis?.bpm} />
              </div>
              <div className="stat-block">
                <span className="stat-label">Key</span>
                {analysis?.camelot ? (
                  <CamelotBadge camelot={analysis.camelot} />
                ) : (
                  <span className="stat-empty">—</span>
                )}
              </div>
            </>
          ) : (
            <div className="stat-block fade-only-stat">
              <span className="stat-label">Mix</span>
              <span className="fade-only-chip">solo fade</span>
            </div>
          )}
          <div className="stat-block stat-time">
            <span className="stat-label">Tempo</span>
            <span className="track-time">
              {formatTime(clock.position)} <span>/</span>{' '}
              {formatTime(clock.duration || (track?.duration ?? 0))}
            </span>
          </div>
        </div>
        <div className="track-head-actions">
          <button
            type="button"
            className="icon-button"
            onClick={openSource}
            aria-label={mode === 'local' ? 'Apri libreria' : 'Apri YouTube'}
          >
            {mode === 'local' ? (
              <FolderOpen size={18} strokeWidth={2.1} />
            ) : (
              <MonitorPlay size={18} strokeWidth={2.1} />
            )}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setPanel('controls')}
            aria-label="Apri controlli deck"
          >
            <SlidersHorizontal size={18} strokeWidth={2.1} />
          </button>
        </div>
      </div>
    </section>
  )
}
