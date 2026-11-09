import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { EqCurve, FilterCurve, TransitionPreset, VolumeCurve } from '../types'
import { formatTransitionLength } from '../lib/format'
import { haptic } from '../lib/haptics'
import { buildTransitionPlan, effectiveCurves } from '../lib/transitions'
import { applyTransitionSettings } from '../state/controller'
import { useMixerStore } from '../state/store'

type Section = 'volume' | 'eq' | 'filter'

const VOLUME_OPTIONS: Array<{ value: VolumeCurve; label: string; hint: string }> = [
  { value: 'smooth', label: 'Smooth crossfade', hint: 'Equal power, sempre naturale' },
  { value: 'overlap', label: 'Overlap', hint: 'Più sovrapposizione al centro' },
  { value: 'linear', label: 'Lineare', hint: 'Salita e discesa costanti' },
  { value: 'cutIn', label: 'Cut in', hint: 'Il nuovo brano entra deciso' },
  { value: 'fadeOutCut', label: 'Fade out cut', hint: 'Uscita rapida, poi taglio' },
]

const EQ_OPTIONS: Array<{ value: EqCurve; label: string; hint: string }> = [
  { value: 'center', label: 'Center bass swap', hint: 'Scambio dei bassi al centro' },
  { value: 'end', label: 'Bass swap at end', hint: 'Scambio verso la fine' },
  { value: 'start', label: 'Bass swap at start', hint: 'Scambio in apertura' },
  { value: 'threeBand', label: 'Three-band sweep', hint: 'Movimento più ampio' },
  { value: 'quickCut', label: 'Quick cut', hint: 'Taglio immediato dei bassi' },
  { value: 'none', label: 'Nessun EQ', hint: 'Nessuna automazione sulle basse' },
]

const FILTER_OPTIONS: Array<{ value: FilterCurve; label: string; hint: string }> = [
  { value: 'none', label: 'Nessuno', hint: 'Nessun filtro in transizione' },
  { value: 'lowOut', label: 'Low pass out', hint: 'Chiude progressivamente l’uscita' },
  { value: 'lowIn', label: 'Low pass in', hint: 'Apre progressivamente l’ingresso' },
  { value: 'lowInLowOut', label: 'Low in → low out', hint: 'Apre l’ingresso e chiude l’uscita' },
  {
    value: 'lowInHighOut',
    label: 'Low in → high out',
    hint: 'Apertura in basso, uscita in alto',
  },
]

const PRESET_LABELS: Record<TransitionPreset, string> = {
  auto: 'Auto',
  fade: 'Fade',
  rise: 'Rise',
  custom: 'Custom',
}

function findLabel<T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T | null,
): string {
  return options.find((option) => option.value === value)?.label ?? '—'
}

export function TransitionPanel() {
  const settings = useMixerStore((state) => state.transition)
  const localSession = useMixerStore((state) => state.localSession)
  const [openSection, setOpenSection] = useState<Section | null>(null)
  const current = localSession.tracks[localSession.currentDeck]
  const bpm = current?.source === 'local' ? (current.analysis?.bpm ?? null) : null
  const plan = useMemo(() => buildTransitionPlan(settings, bpm), [settings, bpm])
  const effective = effectiveCurves(settings.preset, settings)
  const transitionActive = Boolean(localSession.transitionFrom)

  const selectVolume = (value: VolumeCurve) => {
    haptic(5)
    applyTransitionSettings({ preset: 'custom', volumeCurve: value })
    setOpenSection(null)
  }
  const selectEq = (value: EqCurve) => {
    haptic(5)
    applyTransitionSettings({ preset: 'custom', eqCurve: value })
    setOpenSection(null)
  }
  const selectFilter = (value: FilterCurve) => {
    haptic(5)
    applyTransitionSettings({ preset: 'custom', filterCurve: value })
    setOpenSection(null)
  }

  const rows: Array<{
    id: Section
    label: string
    value: string
    tone: string
    options: Array<{ value: string; label: string; hint: string }>
    selected: string
    onSelect: (value: string) => void
  }> = [
    {
      id: 'volume',
      label: 'Volume',
      value: findLabel(VOLUME_OPTIONS, effective.volume),
      tone: 'blue',
      options: VOLUME_OPTIONS,
      selected: effective.volume,
      onSelect: (value) => selectVolume(value as VolumeCurve),
    },
    {
      id: 'eq',
      label: 'EQ',
      value: findLabel(EQ_OPTIONS, effective.eq),
      tone: 'yellow',
      options: EQ_OPTIONS,
      selected: effective.eq,
      onSelect: (value) => selectEq(value as EqCurve),
    },
    {
      id: 'filter',
      label: 'Filter',
      value: findLabel(FILTER_OPTIONS, effective.filter),
      tone: 'purple',
      options: FILTER_OPTIONS,
      selected: effective.filter,
      onSelect: (value) => selectFilter(value as FilterCurve),
    },
  ]

  return (
    <section
      className="transition-panel"
      id="transition-panel"
      aria-label="Automazione transizione"
    >
      <header className="section-heading">
        <div className="section-title">
          <SlidersHorizontal size={17} strokeWidth={2.1} />
          <h2>Transizione</h2>
          <span className="preset-badge">{PRESET_LABELS[settings.preset]}</span>
        </div>
        <span className="section-meta">
          {settings.bars} battute · {formatTransitionLength(plan.duration)}
          {plan.usedFallbackBpm ? ' · 120 BPM' : ''}
        </span>
      </header>

      <div className="automation-card">
        {rows.map((row) => (
          <div className={`automation-row tone-${row.tone}`} key={row.id}>
            <button
              type="button"
              className="automation-head"
              onClick={() => {
                if (transitionActive) return
                haptic(4)
                setOpenSection((currentSection) => (currentSection === row.id ? null : row.id))
              }}
              aria-expanded={openSection === row.id}
              aria-controls={`automation-${row.id}`}
              disabled={transitionActive}
            >
              <span className="automation-tone" aria-hidden="true" />
              <span className="automation-label">{row.label}</span>
              <span className="automation-value">{row.value}</span>
              <ChevronDown
                size={16}
                className={`automation-chevron${openSection === row.id ? ' is-open' : ''}`}
              />
            </button>
            <div
              className={`automation-options${openSection === row.id ? ' is-open' : ''}`}
              id={`automation-${row.id}`}
              role="radiogroup"
              aria-label={row.label}
            >
              {openSection === row.id
                ? row.options.map((option) => {
                    const selected = row.selected === option.value
                    return (
                      <button
                        type="button"
                        key={option.value}
                        role="radio"
                        aria-checked={selected}
                        className={`automation-option${selected ? ' is-selected' : ''}`}
                        onClick={() => row.onSelect(option.value)}
                      >
                        <span className="option-check">
                          {selected ? <Check size={14} strokeWidth={2.6} /> : null}
                        </span>
                        <span className="option-copy">
                          <span>{option.label}</span>
                          <small>{option.hint}</small>
                        </span>
                      </button>
                    )
                  })
                : null}
            </div>
          </div>
        ))}
      </div>

      <div className="transition-footnote">
        <span>
          {transitionActive
            ? 'Mix in corso: le curve restano bloccate fino alla fine.'
            : settings.preset === 'custom'
              ? 'Preset Custom. Trascina il blocco sul waveform per spostare il mix.'
              : `Preset ${PRESET_LABELS[settings.preset]}: curve automatiche. Scegli una voce per passare a Custom.`}
        </span>
        {bpm ? <span className="mono-note">{Math.round(bpm)} BPM</span> : null}
      </div>
    </section>
  )
}
