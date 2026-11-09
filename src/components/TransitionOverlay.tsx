import { GripVertical } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { TransitionPlan, TransitionSettings } from '../types'

type DragMode = 'move' | 'left' | 'right'

interface TransitionOverlayProps {
  plan: TransitionPlan
  settings: TransitionSettings
  left: number
  width: number
  dragging: boolean
  onDragStart: (mode: DragMode, event: ReactPointerEvent<HTMLElement>) => void
  onNudgeStart: (direction: -1 | 1) => void
  onNudgeLength: (direction: -1 | 1) => void
}

function buildPath(values: number[], map: (value: number) => number, stepped = false): string {
  if (values.length === 0) return ''
  let path = ''
  values.forEach((value, index) => {
    const x = (index / (values.length - 1)) * 100
    const y = map(value)
    if (index === 0) {
      path = `M ${x.toFixed(2)} ${y.toFixed(2)}`
    } else if (stepped) {
      path += ` H ${x.toFixed(2)} V ${y.toFixed(2)}`
    } else {
      path += ` L ${x.toFixed(2)} ${y.toFixed(2)}`
    }
  })
  return path
}

export function TransitionOverlay({
  plan,
  settings,
  left,
  width,
  dragging,
  onDragStart,
  onNudgeStart,
  onNudgeLength,
}: TransitionOverlayProps) {
  const volumeOut = buildPath(plan.volumeOut, (value) => 8 + (1 - value) * 42)
  const volumeIn = buildPath(plan.volumeIn, (value) => 92 - value * 42)
  const eqOut = buildPath(plan.eqLowOut, (value) => 50 + (-value / 24) * 12, true)
  const eqIn = buildPath(plan.eqLowIn, (value) => 50 - (-value / 24) * 12, true)
  const hasEq = plan.eqLowOut.some((value) => value < -0.5)

  return (
    <div
      className={`transition-overlay${dragging ? ' is-dragging' : ''}`}
      style={{ left: `${left * 100}%`, width: `${Math.max(width, 0.035) * 100}%` }}
      onPointerDown={(event) => onDragStart('move', event)}
      onClick={(event) => event.stopPropagation()}
      data-no-seek
    >
      <svg
        className="transition-curves"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line x1="50" y1="0" x2="50" y2="100" className="transition-midline" />
        <path d={volumeOut} className="curve curve-volume" />
        <path d={volumeIn} className="curve curve-volume" />
        {hasEq ? <path d={eqOut} className="curve curve-eq" /> : null}
        {hasEq ? <path d={eqIn} className="curve curve-eq" /> : null}
      </svg>

      <div className="transition-badge" aria-hidden="true">
        {settings.preset === 'auto' ? 'AUTO' : settings.preset.toUpperCase()}
      </div>

      <button
        type="button"
        className="transition-handle transition-handle-left"
        onPointerDown={(event) => {
          event.stopPropagation()
          onDragStart('left', event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') onNudgeStart(-1)
          if (event.key === 'ArrowRight') onNudgeStart(1)
        }}
        aria-label="Regola l'inizio del mix. Frecce per spostare."
      >
        <span aria-hidden="true" />
      </button>

      <button
        type="button"
        className="transition-grip"
        onPointerDown={(event) => {
          event.stopPropagation()
          onDragStart('move', event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') onNudgeStart(-1)
          if (event.key === 'ArrowRight') onNudgeStart(1)
        }}
        aria-label="Sposta il blocco della transizione. Frecce per spostare."
      >
        <GripVertical size={14} strokeWidth={2.6} />
      </button>

      <button
        type="button"
        className="transition-handle transition-handle-right"
        onPointerDown={(event) => {
          event.stopPropagation()
          onDragStart('right', event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') onNudgeLength(-1)
          if (event.key === 'ArrowRight') onNudgeLength(1)
        }}
        aria-label="Regola la durata del mix. Frecce per cambiare battute."
      >
        <span aria-hidden="true" />
      </button>
    </div>
  )
}
