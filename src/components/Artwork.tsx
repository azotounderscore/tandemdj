import { Music2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Track } from '../types'

type ArtworkSize = 'xs' | 'sm' | 'md' | 'lg'

interface ArtworkProps {
  track: Track | null
  size?: ArtworkSize
  className?: string
}

const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ['#ff795c', '#b1319d', '#35133f'],
  ['#52b8ff', '#2f5dff', '#101a4a'],
  ['#c8ff4d', '#19a874', '#0b322a'],
  ['#ffd166', '#e85d75', '#3d1024'],
  ['#b58cff', '#5c40ff', '#18123d'],
  ['#5de4d0', '#167a9c', '#0b2433'],
]

function seedFor(track: Track): number {
  if (track.source === 'local') return track.colorIndex
  let hash = 0
  for (const char of track.id) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return hash % PALETTES.length
}

function initialsFor(track: Track | null): string {
  if (!track) return ''
  const cleaned = track.title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
  if (!cleaned) return 'TD'
  const words = cleaned.split(/\s+/).filter(Boolean)
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`
      : (words[0]?.slice(0, 2) ?? 'TD')
  return letters.toUpperCase()
}

export function Artwork({ track, size = 'md', className = '' }: ArtworkProps) {
  const palette = PALETTES[track ? seedFor(track) : 0] ?? PALETTES[0]!
  const style = {
    '--art-a': palette[0],
    '--art-b': palette[1],
    '--art-c': palette[2],
  } as CSSProperties
  const hasThumbnail = track?.source === 'youtube' && Boolean(track.thumbnail)

  return (
    <div className={`artwork artwork-${size} ${className}`.trim()} style={style}>
      <span className="artwork-orb artwork-orb-a" aria-hidden="true" />
      <span className="artwork-orb artwork-orb-b" aria-hidden="true" />
      <span className="artwork-grid" aria-hidden="true" />
      {hasThumbnail ? (
        <img
          className="artwork-image"
          src={track?.source === 'youtube' ? track.thumbnail : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : null}
      <span className="artwork-initials" aria-hidden="true">
        {initialsFor(track)}
      </span>
      {!track ? <Music2 className="artwork-empty-icon" aria-hidden="true" /> : null}
      <span className="artwork-sheen" aria-hidden="true" />
    </div>
  )
}
