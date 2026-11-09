export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--'
  }
  const rounded = Math.floor(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const secs = rounded % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export function formatBpm(bpm: number | null | undefined): string {
  return bpm && Number.isFinite(bpm) ? String(Math.round(bpm)) : '—'
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`
}

export function formatRelativeDate(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'adesso'
  if (minutes < 60) return `${minutes} min fa`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h fa`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} g fa`
  return new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'short' }).format(timestamp)
}

export interface ParsedFileName {
  title: string
  artist: string
}

/**
 * Best-effort display metadata from a file name. No ID3 parser is used: files
 * stay untouched and this never reads their bytes.
 */
export function parseFileName(fileName: string): ParsedFileName {
  const withoutExtension = fileName.replace(/\.[a-z0-9]{1,5}$/i, '')
  const cleaned = withoutExtension.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const split = cleaned.split(/\s[-–—]\s/)
  if (split.length >= 2) {
    const artist = split[0]?.trim()
    const title = split.slice(1).join(' - ').trim()
    if (artist && title) return { title, artist }
  }
  return { title: cleaned || 'Brano senza titolo', artist: 'Artista locale' }
}

export function formatTransitionLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 s'
  if (seconds < 60) return `${Math.round(seconds)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
}

export function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}
