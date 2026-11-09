import { ChevronDown, Clock3, Magnet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BarCount, LocalTrack } from '../types'
import { formatTime, formatTransitionLength } from '../lib/format'
import { haptic } from '../lib/haptics'
import { buildTransitionPlan, nearestBarCount, secondsPerBar, snapToBeat } from '../lib/transitions'
import {
  applyTransitionSettings,
  seekCurrentFraction,
  setPlannedMixStart,
} from '../state/controller'
import { useMixerStore } from '../state/store'
import { useDeckClock } from '../hooks/useDeckClock'
import { TransitionOverlay } from './TransitionOverlay'
import { WaveformCanvas } from './WaveformCanvas'

const BAR_OPTIONS: BarCount[] = [1, 2, 4, 8, 16, 32]
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

interface DragState {
  mode: 'move' | 'left' | 'right'
  startX: number
  startSeconds: number
  startDuration: number
  width: number
}

function WaveRow({
  track,
  deck,
  peaks,
  isCurrent,
  progress,
}: {
  track: LocalTrack | null
  deck: 'A' | 'B'
  peaks: number[] | null
  isCurrent: boolean
  progress: { progress: number; stage: string } | undefined
}) {
  return (
    <div className={`wave-row${isCurrent ? ' is-current' : ''}`} data-deck={deck}>
      <WaveformCanvas
        peaks={peaks}
        seed={track?.colorIndex ?? (deck === 'A' ? 1 : 4)}
        variant={peaks ? 'track' : 'empty'}
      />
      <span className="wave-deck-tag">
        <span>{deck}</span>
        {track ? (isCurrent ? 'in play' : 'prossimo') : 'libero'}
      </span>
      <span className="wave-track-tag">{track?.title ?? `Deck ${deck} libero`}</span>
      {track && !peaks ? (
        <span className="wave-status">
          {progress ? (
            <>
              <span className="mini-spinner" aria-hidden="true" />
              {progress.stage} {Math.round(progress.progress * 100)}%
            </>
          ) : (
            'Waveform non disponibile'
          )}
        </span>
      ) : null}
      {!track ? (
        <span className="wave-empty-copy">
          <span className="eyebrow">Deck {deck}</span>
          <strong>{isCurrent ? 'Carica il primo brano' : 'Aggiungi il prossimo brano'}</strong>
          <span>Apri la libreria per iniziare.</span>
        </span>
      ) : null}
    </div>
  )
}

export function WaveformStage() {
  const session = useMixerStore((state) => state.localSession)
  const settings = useMixerStore((state) => state.transition)
  const analysisProgress = useMixerStore((state) => state.analysisProgress)
  const stackRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const current = session.tracks[session.currentDeck]
  const next = session.tracks[session.nextDeck]
  const currentLocal = current?.source === 'local' ? current : null
  const nextLocal = next?.source === 'local' ? next : null
  const bpm = currentLocal?.analysis?.bpm ?? null
  const firstBeat = currentLocal?.analysis?.firstBeat ?? 0
  const clock = useDeckClock('local', session.currentDeck, current?.duration ?? 0)
  const duration = clock.duration || current?.duration || 0
  const plan = useMemo(() => buildTransitionPlan(settings, bpm), [settings, bpm])

  const transitionActive = Boolean(session.transitionFrom)
  const fadeDuration = Math.min(plan.duration, duration || plan.duration)
  const rawStart = session.mixStart ?? Math.max(0, duration - fadeDuration)
  const start = duration > 0 ? clamp(rawStart, 0, Math.max(0, duration - 0.5)) : 0
  const left = duration > 0 ? start / duration : 0
  const width = duration > 0 ? Math.min(fadeDuration / duration, 1 - left) : 0
  const playhead = duration > 0 ? clamp(clock.position / duration, 0, 1) : 0
  const canShowOverlay = Boolean(current && next && duration > 0)

  const beginDrag = (mode: 'move' | 'left' | 'right', event: ReactPointerEvent<HTMLElement>) => {
    if (!canShowOverlay || transitionActive) return
    event.preventDefault()
    event.stopPropagation()
    const widthNow = stackRef.current?.getBoundingClientRect().width ?? 1
    haptic(4)
    setDrag({
      mode,
      startX: event.clientX,
      startSeconds: start,
      startDuration: fadeDuration,
      width: Math.max(1, widthNow),
    })
  }

  useEffect(() => {
    if (!drag) return
    document.body.classList.add('is-dragging-mix')
    const handleMove = (event: PointerEvent) => {
      const deltaSeconds = ((event.clientX - drag.startX) / drag.width) * duration
      if (drag.mode === 'right') {
        const desired = clamp(
          drag.startDuration + deltaSeconds,
          0.5,
          Math.max(0.5, duration - drag.startSeconds),
        )
        const bars = nearestBarCount(desired / secondsPerBar(bpm), 1)
        const snapshot = useMixerStore.getState()
        if (bars !== snapshot.transition.bars) applyTransitionSettings({ bars })
        setPlannedMixStart(drag.startSeconds)
        return
      }
      const raw = clamp(drag.startSeconds + deltaSeconds, 0, Math.max(0, duration))
      const snapped = settings.snapToBeat ? snapToBeat(raw, bpm, firstBeat, 'nearest') : raw
      setPlannedMixStart(snapped)
    }
    const handleUp = () => setDrag(null)
    window.addEventListener('pointermove', handleMove, { passive: true })
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      document.body.classList.remove('is-dragging-mix')
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [drag, duration, bpm, firstBeat, settings.snapToBeat])

  const seekAtClientX = (clientX: number) => {
    const rect = stackRef.current?.getBoundingClientRect()
    if (!rect || !current) return
    seekCurrentFraction(clamp((clientX - rect.left) / rect.width, 0, 1))
  }

  const nudgeStart = (direction: -1 | 1) => {
    if (transitionActive) return
    const beat = 60 / (bpm && bpm > 0 ? bpm : 120)
    setPlannedMixStart(clamp(start + direction * beat, 0, Math.max(0, duration)))
  }

  const nudgeLength = (direction: -1 | 1) => {
    if (transitionActive) return
    applyTransitionSettings({ bars: nearestBarCount(settings.bars + direction, 1) })
    setPlannedMixStart(start)
  }

  const changeBars = (bars: BarCount) => {
    if (transitionActive) return
    haptic(5)
    applyTransitionSettings({ bars })
    setPlannedMixStart(start)
  }

  const toggleSnap = () => {
    haptic(5)
    applyTransitionSettings({ snapToBeat: !settings.snapToBeat })
  }

  return (
    <section className="waveform-stage" aria-label="Mix e waveform">
      <header className="wave-toolbar">
        <div className="wave-toolbar-title">
          <span className="eyebrow">Mix editor</span>
          <span className="wave-toolbar-mode">
            Deck {session.currentDeck} <span aria-hidden="true">→</span> Deck {session.nextDeck}
          </span>
        </div>
        <span className="wave-time">
          {formatTime(clock.position)} <span>/</span> {formatTime(duration || current?.duration)}
        </span>
      </header>

      <div className={`wave-stack${transitionActive ? ' is-transitioning' : ''}`} ref={stackRef}>
        <div
          className="wave-seekable"
          role="slider"
          tabIndex={current ? 0 : -1}
          aria-label="Posizione del brano corrente"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.round(duration))}
          aria-valuenow={Math.round(clock.position)}
          aria-valuetext={formatTime(clock.position)}
          aria-disabled={!current}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[data-no-seek]')) return
            seekAtClientX(event.clientX)
          }}
          onKeyDown={(event) => {
            if (!current) return
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              const step = event.shiftKey ? 15 : 5
              seekCurrentFraction(
                clamp(clock.position + (event.key === 'ArrowRight' ? step : -step), 0, duration) /
                  Math.max(1, duration),
              )
            }
            if (event.key === 'Home') {
              event.preventDefault()
              seekCurrentFraction(0)
            }
            if (event.key === 'End') {
              event.preventDefault()
              seekCurrentFraction(0.98)
            }
          }}
        >
          <WaveRow
            track={currentLocal}
            deck={session.currentDeck}
            peaks={currentLocal?.analysis?.peaks ?? null}
            isCurrent
            progress={analysisProgress[currentLocal?.id ?? '']}
          />
          <WaveRow
            track={nextLocal}
            deck={session.nextDeck}
            peaks={nextLocal?.analysis?.peaks ?? null}
            isCurrent={false}
            progress={analysisProgress[nextLocal?.id ?? '']}
          />
          {current ? (
            <div
              className="wave-played"
              style={{ width: `${playhead * 100}%` }}
              aria-hidden="true"
            />
          ) : null}
          {current ? (
            <div
              className="wave-playhead"
              style={{ left: `${playhead * 100}%` }}
              aria-hidden="true"
            >
              <span />
            </div>
          ) : null}
        </div>

        {canShowOverlay ? (
          <TransitionOverlay
            plan={plan}
            settings={settings}
            left={left}
            width={width}
            dragging={Boolean(drag)}
            onDragStart={beginDrag}
            onNudgeStart={nudgeStart}
            onNudgeLength={nudgeLength}
          />
        ) : null}
      </div>

      <div className="wave-footer">
        <div className="bars-cluster">
          <label className={`bars-pill${transitionActive ? ' is-disabled' : ''}`}>
            <span className="sr-only">Durata transizione in battute</span>
            <select
              value={settings.bars}
              onChange={(event) => changeBars(Number(event.target.value) as BarCount)}
              disabled={transitionActive}
            >
              {BAR_OPTIONS.map((bars) => (
                <option key={bars} value={bars}>
                  {bars} {bars === 1 ? 'battuta' : 'battute'}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          <span className="mix-length">
            <Clock3 size={13} />
            {formatTransitionLength(plan.duration)}
          </span>
        </div>

        <div className="wave-footer-meta">
          {currentLocal?.analysis ? (
            <span>{Math.round(currentLocal.analysis.bpm)} BPM</span>
          ) : current ? (
            <span className="fallback-note">120 BPM fallback</span>
          ) : null}
          <span className="meta-dot" aria-hidden="true" />
          <span>{settings.snapToBeat ? 'beat grid' : 'freehand'}</span>
        </div>

        <button
          type="button"
          className={`snap-chip${settings.snapToBeat ? ' is-on' : ''}`}
          onClick={toggleSnap}
          aria-pressed={settings.snapToBeat}
        >
          <Magnet size={13} />
          Snap
        </button>
      </div>
    </section>
  )
}
