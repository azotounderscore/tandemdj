import { Info, Loader2, MonitorPlay, Pause, Play, Scissors, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { youtubeEngine } from '../audio/youtube-engine'
import { formatTime } from '../lib/format'
import { useDeckClock } from '../hooks/useDeckClock'
import { cueDeck, seekDeck, toggleDeckPlay } from '../state/controller'
import { activeSession, useMixerStore } from '../state/store'
import type { DeckId } from '../types'
import { Artwork } from './Artwork'

function YouTubeDeck({
  deck,
  frameRef,
  ready,
}: {
  deck: DeckId
  frameRef: RefObject<HTMLDivElement | null>
  ready: boolean
}) {
  const session = useMixerStore(activeSession)
  const setPanel = useMixerStore((state) => state.setPanel)
  const track = session.tracks[deck]
  const video = track?.source === 'youtube' ? track : null
  const playing = session.playing[deck]
  const loading = session.loading[deck]
  const transitionActive = Boolean(session.transitionFrom)
  const clock = useDeckClock('youtube', deck, track?.duration ?? 0, 120)
  const duration = clock.duration || track?.duration || 0
  const isCurrent = session.currentDeck === deck

  return (
    <article className={`yt-deck${isCurrent ? ' is-current' : ''}`}>
      <header className="yt-deck-head">
        <span className="yt-deck-letter">{deck}</span>
        <div className="yt-deck-heading">
          <span className="eyebrow">
            {track
              ? isCurrent
                ? playing
                  ? 'In riproduzione'
                  : 'Deck corrente'
                : 'Prossimo'
              : 'Deck libero'}
          </span>
          <strong>{track?.title ?? 'Nessun video'}</strong>
          <span>{track?.artist ?? 'Scegli un video dal pannello YouTube.'}</span>
        </div>
        <span className="fade-only-chip">FADE ONLY</span>
      </header>

      <div className="yt-frame-wrap">
        <div ref={frameRef} className="yt-frame" aria-hidden="true" />
        <div className="yt-frame-vignette" aria-hidden="true" />
        {!ready ? (
          <div className="yt-frame-state">
            <Loader2 size={20} className="spin" />
            <span>Carico il player ufficiale…</span>
          </div>
        ) : !video ? (
          <div className="yt-frame-state">
            <span className="yt-placeholder-art">
              <Artwork track={null} size="sm" />
            </span>
            <strong>Deck {deck} libero</strong>
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => setPanel('youtube')}
            >
              <MonitorPlay size={14} /> Scegli un video
            </button>
          </div>
        ) : null}
        {video ? (
          <span className="yt-live-tag">
            <span className={`live-dot${playing ? ' is-playing' : ''}`} aria-hidden="true" />
            {playing ? 'in play' : 'pronto'}
          </span>
        ) : null}
      </div>

      <div className="yt-deck-controls">
        <div className="yt-deck-track">
          <Artwork track={track} size="xs" />
          <div>
            <strong>{video?.title ?? 'In attesa di un video'}</strong>
            <span>
              {formatTime(clock.position)} / {formatTime(duration)}
            </span>
          </div>
        </div>
        <input
          className="yt-seek"
          type="range"
          min={0}
          max={Math.max(1, duration)}
          step={1}
          value={Math.min(clock.position, Math.max(1, duration))}
          onChange={(event) => seekDeck(deck, Number(event.target.value))}
          disabled={!video || !ready}
          aria-label={`Posizione deck ${deck}`}
        />
        <div className="yt-buttons">
          <button
            type="button"
            className="yt-play-button"
            onClick={() => void toggleDeckPlay(deck)}
            disabled={!video || !ready || transitionActive}
            aria-label={`${playing ? 'Pausa' : 'Riproduci'} YouTube deck ${deck}`}
          >
            {loading ? (
              <Loader2 size={16} className="spin" />
            ) : playing ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => cueDeck(deck)}
            disabled={!video || !ready || transitionActive}
          >
            <Scissors size={13} /> Cue
          </button>
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => setPanel('youtube')}
          >
            <MonitorPlay size={13} /> Video
          </button>
        </div>
      </div>
    </article>
  )
}

export function YouTubeStage() {
  const frameA = useRef<HTMLDivElement>(null)
  const frameB = useRef<HTMLDivElement>(null)
  const youtubeSession = useMixerStore((state) => state.youtubeSession)
  const controls = useMixerStore((state) => state.controls)
  const masterVolume = useMixerStore((state) => state.settings.masterVolume)
  const crossfaderCurve = useMixerStore((state) => state.settings.crossfaderCurve)
  const setPanel = useMixerStore((state) => state.setPanel)
  const [ready, setReady] = useState(false)
  const [mountError, setMountError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const mount = async () => {
      const containerA = frameA.current
      const containerB = frameB.current
      if (!containerA || !containerB) return
      try {
        await Promise.all([
          youtubeEngine.mount('A', containerA),
          youtubeEngine.mount('B', containerB),
        ])
        if (cancelled) return
        setReady(true)
      } catch (error) {
        if (cancelled) return
        setMountError(
          error instanceof Error ? error.message : 'Impossibile inizializzare i player YouTube.',
        )
      }
    }
    void mount()
    return () => {
      cancelled = true
      youtubeEngine.destroyAll()
    }
  }, [attempt])

  const videoA = youtubeSession.tracks.A?.source === 'youtube' ? youtubeSession.tracks.A : null
  const videoB = youtubeSession.tracks.B?.source === 'youtube' ? youtubeSession.tracks.B : null

  useEffect(() => {
    if (!ready || !videoA) return
    void youtubeEngine.load('A', videoA.videoId).catch((error: unknown) => {
      setMountError(error instanceof Error ? error.message : 'Video A non caricato.')
    })
  }, [ready, videoA])

  useEffect(() => {
    if (!ready || !videoB) return
    void youtubeEngine.load('B', videoB.videoId).catch((error: unknown) => {
      setMountError(error instanceof Error ? error.message : 'Video B non caricato.')
    })
  }, [ready, videoB])

  useEffect(() => {
    if (!ready) return
    youtubeEngine.setBaseVolume('A', controls.A.volume * masterVolume)
    youtubeEngine.setBaseVolume('B', controls.B.volume * masterVolume)
    youtubeEngine.setCrossfader(
      youtubeSession.currentDeck,
      youtubeSession.crossfader,
      crossfaderCurve,
      true,
    )
  }, [
    ready,
    controls.A.volume,
    controls.B.volume,
    masterVolume,
    youtubeSession.currentDeck,
    youtubeSession.crossfader,
    crossfaderCurve,
  ])

  return (
    <section className="yt-stage" aria-label="Mixer YouTube">
      <header className="yt-stage-head">
        <div>
          <span className="eyebrow">Mixer video</span>
          <h2>YouTube, player ufficiale</h2>
        </div>
        <button type="button" className="ghost-button compact" onClick={() => setPanel('youtube')}>
          <MonitorPlay size={14} /> Apri pannello
        </button>
      </header>

      {mountError ? (
        <div className="yt-error" role="alert">
          <TriangleAlert size={18} />
          <span>{mountError}</span>
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => {
              youtubeEngine.destroyAll()
              setReady(false)
              setMountError(null)
              setAttempt((value) => value + 1)
            }}
          >
            Riprova
          </button>
        </div>
      ) : null}

      <div className="yt-decks">
        <YouTubeDeck deck="A" frameRef={frameA} ready={ready} />
        <YouTubeDeck deck="B" frameRef={frameB} ready={ready} />
      </div>

      <div className="yt-limits">
        <Info size={17} />
        <div>
          <strong>Solo fade, per scelta e per limite tecnico</strong>
          <p>
            Il player IFrame ufficiale non espone il flusso audio al browser. EQ, filtro, gain,
            waveform, BPM, key e beatgrid non sono disponibili. La transizione YouTube usa solo
            curve di volume e non è beat-matched.
          </p>
        </div>
      </div>
    </section>
  )
}
