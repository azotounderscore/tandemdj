import { Pause, Play, RotateCcw, Scissors, Target } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatTime } from '../lib/format'
import { useDeckClock } from '../hooks/useDeckClock'
import { cueDeck, setCuePoint, setDeckControls, toggleDeckPlay } from '../state/controller'
import { activeSession, useMixerStore } from '../state/store'
import type { DeckId } from '../types'
import { Artwork } from './Artwork'
import { BpmValue, CamelotBadge, SourceBadge } from './Badges'
import { BottomSheet } from './BottomSheet'
import { RangeField } from './RangeField'

interface DeckControlsSheetProps {
  open: boolean
  onClose: () => void
}

const formatDb = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
const formatPercent = (value: number) => `${Math.round(value * 100)}%`
const formatFilter = (value: number) => `${Math.round((1 - value) * 100)}% aperto`

export function DeckControlsSheet({ open, onClose }: DeckControlsSheetProps) {
  const mode = useMixerStore((state) => state.mode)
  const session = useMixerStore(activeSession)
  const controls = useMixerStore((state) => state.controls)
  const [selected, setSelected] = useState<DeckId>(session.currentDeck)

  useEffect(() => {
    if (open) setSelected(session.currentDeck)
    // The open transition is intentional: we sync the tab when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const track = session.tracks[selected]
  const deckControls = controls[selected]
  const clock = useDeckClock(mode, selected, track?.duration ?? 0, 250)
  const isYoutube = mode === 'youtube'
  const analysis = track?.source === 'local' ? track.analysis : null

  const update = (patch: Partial<typeof deckControls>) => setDeckControls(selected, patch)
  const reset = () => {
    setDeckControls(selected, {
      volume: 0.82,
      gainDb: 0,
      lowDb: 0,
      midDb: 0,
      highDb: 0,
      filter: 0,
    })
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Controlli deck"
      subtitle={
        isYoutube
          ? 'Sul player IFrame è disponibile solo il volume.'
          : 'Web Audio · elaborazione locale'
      }
    >
      <div className="deck-tabs" role="tablist" aria-label="Scegli deck">
        {(['A', 'B'] as DeckId[]).map((deck) => {
          const deckTrack = session.tracks[deck]
          const playing = session.playing[deck]
          return (
            <button
              type="button"
              role="tab"
              key={deck}
              aria-selected={selected === deck}
              className={`deck-tab${selected === deck ? ' is-active' : ''}`}
              onClick={() => setSelected(deck)}
            >
              <span className="deck-tab-letter">{deck}</span>
              <span className="deck-tab-copy">
                <span>{deckTrack?.title ?? 'Deck vuoto'}</span>
                <small>
                  {deck === session.currentDeck ? 'in riproduzione' : 'in arrivo'}
                  {playing ? ' · live' : ''}
                </small>
              </span>
            </button>
          )
        })}
      </div>

      <div className="deck-control-head">
        <Artwork track={track} size="sm" />
        <div className="deck-control-copy">
          <strong>{track?.title ?? `Deck ${selected} vuoto`}</strong>
          <span>{track?.artist ?? 'Carica un brano per usare i controlli.'}</span>
          <div className="deck-control-tags">
            {track ? <SourceBadge source={track.source} /> : null}
            {analysis ? <BpmValue bpm={analysis.bpm} /> : null}
            {analysis?.camelot ? <CamelotBadge camelot={analysis.camelot} /> : null}
          </div>
        </div>
        <span className="deck-clock">
          {formatTime(clock.position)}
          <small>/ {formatTime(clock.duration || track?.duration)}</small>
        </span>
      </div>

      <div className="deck-transport">
        <button
          type="button"
          className={`primary-button deck-play-main${session.playing[selected] ? ' is-playing' : ''}`}
          onClick={() => void toggleDeckPlay(selected)}
          disabled={!track || Boolean(session.transitionFrom)}
        >
          {session.playing[selected] ? (
            <Pause size={17} fill="currentColor" />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
          {session.playing[selected] ? 'Pausa' : 'Play'}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => cueDeck(selected)}
          disabled={!track || Boolean(session.transitionFrom)}
        >
          <Scissors size={15} />
          Cue
        </button>
        {!isYoutube ? (
          <button
            type="button"
            className="ghost-button"
            onClick={() => setCuePoint(selected)}
            disabled={!track || Boolean(session.transitionFrom)}
          >
            <Target size={15} />
            Set cue
          </button>
        ) : null}
        <button type="button" className="ghost-button" onClick={reset} disabled={!track}>
          <RotateCcw size={14} />
          Reset
        </button>
      </div>

      <div className="deck-sliders">
        <RangeField
          label="Volume"
          value={deckControls.volume}
          min={0}
          max={1}
          step={0.01}
          format={formatPercent}
          onChange={(value) => update({ volume: value })}
          onReset={() => update({ volume: 0.82 })}
        />
        <RangeField
          label="Gain"
          value={deckControls.gainDb}
          min={-12}
          max={12}
          step={0.1}
          format={formatDb}
          zeroAt={0}
          onChange={(value) => update({ gainDb: value })}
          onReset={() => update({ gainDb: 0 })}
          disabled={isYoutube}
          hint={isYoutube ? 'Il gain richiede il grafo Web Audio locale.' : undefined}
        />

        <div className="eq-group">
          <div className="eq-group-head">
            <span>3-band EQ</span>
            {isYoutube ? <small>non disponibile su IFrame</small> : null}
          </div>
          <RangeField
            label="Low"
            value={deckControls.lowDb}
            min={-18}
            max={12}
            step={0.1}
            format={formatDb}
            zeroAt={0}
            onChange={(value) => update({ lowDb: value })}
            onReset={() => update({ lowDb: 0 })}
            disabled={isYoutube}
          />
          <RangeField
            label="Mid"
            value={deckControls.midDb}
            min={-18}
            max={12}
            step={0.1}
            format={formatDb}
            zeroAt={0}
            onChange={(value) => update({ midDb: value })}
            onReset={() => update({ midDb: 0 })}
            disabled={isYoutube}
          />
          <RangeField
            label="High"
            value={deckControls.highDb}
            min={-18}
            max={12}
            step={0.1}
            format={formatDb}
            zeroAt={0}
            onChange={(value) => update({ highDb: value })}
            onReset={() => update({ highDb: 0 })}
            disabled={isYoutube}
          />
        </div>

        <RangeField
          label="Filter"
          value={deckControls.filter}
          min={0}
          max={1}
          step={0.01}
          format={formatFilter}
          onChange={(value) => update({ filter: value })}
          onReset={() => update({ filter: 0 })}
          disabled={isYoutube}
          hint={
            isYoutube
              ? 'Il filtro richiede il grafo Web Audio locale.'
              : 'Low-pass · 20 kHz → 180 Hz'
          }
        />

        {!isYoutube ? (
          <div className="cue-point-card">
            <span>
              <Target size={14} /> Cue point
            </span>
            <strong>{formatTime(deckControls.cuePoint)}</strong>
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => setCuePoint(selected)}
              disabled={!track}
            >
              Imposta qui
            </button>
          </div>
        ) : (
          <div className="limit-note">
            <span className="limit-dot" aria-hidden="true" />
            <span>
              Con YouTube il browser non espone il flusso audio: EQ, filtro, gain, waveform e
              beatgrid non sono disponibili. La transizione usa solo il volume.
            </span>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
