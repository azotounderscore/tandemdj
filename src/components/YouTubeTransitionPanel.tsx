import { ChevronDown, Clock3, Info, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import type { BarCount } from '../types'
import { formatTransitionLength } from '../lib/format'
import { haptic } from '../lib/haptics'
import { buildTransitionPlan } from '../lib/transitions'
import { applyTransitionSettings, toggleAutoMix } from '../state/controller'
import { useMixerStore } from '../state/store'

const BARS: BarCount[] = [1, 2, 4, 8, 16, 32]

export function YouTubeTransitionPanel() {
  const transition = useMixerStore((state) => state.transition)
  const session = useMixerStore((state) => state.youtubeSession)
  const plan = useMemo(() => buildTransitionPlan(transition, null), [transition])
  const transitionActive = Boolean(session.transitionFrom)

  return (
    <section className="transition-panel yt-transition-panel" aria-label="Transizione YouTube">
      <header className="section-heading">
        <div className="section-title">
          <Clock3 size={17} strokeWidth={2.1} />
          <h2>Fade YouTube</h2>
          <span className="preset-badge">{transition.bars} battute</span>
        </div>
        <span className="section-meta">{formatTransitionLength(plan.duration)} · 120 BPM</span>
      </header>
      <div className="yt-fade-controls">
        <label className={`bars-pill${transitionActive ? ' is-disabled' : ''}`}>
          <span className="sr-only">Durata fade in battute</span>
          <select
            value={transition.bars}
            disabled={transitionActive}
            onChange={(event) => {
              haptic(5)
              applyTransitionSettings({ bars: Number(event.target.value) as BarCount })
            }}
          >
            {BARS.map((bars) => (
              <option key={bars} value={bars}>
                {bars} {bars === 1 ? 'battuta' : 'battute'}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
        <button
          type="button"
          className={`auto-mix-chip${transition.autoMix ? ' is-on' : ''}`}
          onClick={() => {
            haptic(7)
            toggleAutoMix()
          }}
          aria-pressed={transition.autoMix}
        >
          <Sparkles size={13} />
          Auto mix {transition.autoMix ? 'on' : 'off'}
        </button>
        <span className="yt-fade-badge">solo volume</span>
      </div>
      <p className="yt-fade-note">
        <Info size={14} />
        La durata usa 120 BPM di riferimento perché il player IFrame non espone BPM o beatgrid.
      </p>
    </section>
  )
}
