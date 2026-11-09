export const CAMELOT_MINOR: readonly string[] = [
  'Abm',
  'Ebm',
  'Bbm',
  'Fm',
  'Cm',
  'Gm',
  'Dm',
  'Am',
  'Em',
  'Bm',
  'F#m',
  'C#m',
]

export const CAMELOT_MAJOR: readonly string[] = [
  'B',
  'F#',
  'Db',
  'Ab',
  'Eb',
  'Bb',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
]

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
}

export interface MusicalKey {
  root: string
  mode: 'major' | 'minor'
}

/** Converts a musical key to the Camelot Wheel notation (e.g. A minor -> 8A). */
export function toCamelot(root: string, mode: 'major' | 'minor'): string {
  const semitone = NOTE_TO_SEMITONE[root]
  if (semitone === undefined) return '—'
  // The Camelot wheel ascends in fifths (seven semitones) from B major and
  // from Ab minor. The modulo keeps the classic wheel positions:
  // B major = 1B, C major = 8B, Ab minor = 1A, A minor = 8A.
  const mod12 = (value: number) => ((value % 12) + 12) % 12
  const majorIndex = mod12(7 * (semitone + 1)) // 1B = B (semitone 11)
  const minorIndex = mod12(7 * (semitone - 8)) // 1A = Ab (semitone 8)
  return mode === 'major' ? `${majorIndex + 1}B` : `${minorIndex + 1}A`
}

/** Human readable key from a Camelot code. */
export function camelotToKey(camelot: string): string {
  const match = /^(\d{1,2})([AB])$/i.exec(camelot.trim())
  if (!match) return '—'
  const number = Number(match[1])
  const mode = match[2]?.toUpperCase()
  if (number < 1 || number > 12) return '—'
  const key = mode === 'A' ? CAMELOT_MINOR[number - 1] : CAMELOT_MAJOR[number - 1]
  if (!key) return '—'
  // The minor table stores short notation ("Am"); the readable label needs
  // just the root before the mode name.
  return mode === 'A' ? `${key.replace(/m$/, '')} minor` : `${key} major`
}

/**
 * Standard harmonic-mixing helper. Returns true for the same key, adjacent
 * Camelot numbers and relative major/minor pairs.
 */
export function keysAreCompatible(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null
  const ma = /^(\d{1,2})([AB])$/i.exec(a)
  const mb = /^(\d{1,2})([AB])$/i.exec(b)
  if (!ma || !mb) return null
  const na = Number(ma[1])
  const nb = Number(mb[1])
  if (na === nb) return true
  const distance = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12)
  return distance === 1
}

export function camelotHue(camelot: string | null | undefined): number {
  if (!camelot) return 210
  const match = /^(\d{1,2})/.exec(camelot)
  const n = match ? Number(match[1]) : 1
  const hues = [330, 158, 190, 82, 48, 24, 358, 310, 275, 248, 212, 175]
  return hues[(n - 1) % 12] ?? 210
}

export function canonicalKey(root: string, mode: 'major' | 'minor'): MusicalKey {
  const semitone = NOTE_TO_SEMITONE[root] ?? 0
  const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return { root: sharpNames[semitone] ?? 'C', mode }
}
