import type { CSSProperties } from 'react'
import { camelotHue, camelotToKey } from '../lib/keys'
import { formatBpm } from '../lib/format'

export function CamelotBadge({ camelot }: { camelot: string | null | undefined }) {
  if (!camelot) return null
  const style = { '--camelot-hue': camelotHue(camelot) } as CSSProperties
  return (
    <span className="camelot-badge" style={style} title={camelotToKey(camelot)}>
      {camelot}
    </span>
  )
}

export function BpmValue({
  bpm,
  fallback = '—',
}: {
  bpm: number | null | undefined
  fallback?: string
}) {
  return (
    <span className="bpm-value">
      {bpm && bpm > 0 ? formatBpm(bpm) : fallback}
      {bpm && bpm > 0 ? <small>bpm</small> : null}
    </span>
  )
}

export function DeckChip({ deck, muted = false }: { deck: 'A' | 'B'; muted?: boolean }) {
  return (
    <span className={`deck-chip${muted ? ' is-muted' : ''}`} aria-label={`Deck ${deck}`}>
      {deck}
    </span>
  )
}

export function SourceBadge({ source }: { source: 'local' | 'youtube' }) {
  return (
    <span className={`source-badge source-${source}`}>
      <span className="source-dot" aria-hidden="true" />
      {source === 'local' ? 'Locale' : 'IFrame'}
    </span>
  )
}
