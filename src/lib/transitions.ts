import type {
  BarCount,
  EqCurve,
  FilterCurve,
  TransitionPlan,
  TransitionPreset,
  TransitionSettings,
  VolumeCurve,
} from '../types'
import { clamp } from './format'

export const CURVE_SAMPLES = 65
export const FALLBACK_BPM = 120
const MIN_BPM = 55
const MAX_BPM = 220

const smoothstep = (value: number): number => {
  const x = clamp(value, 0, 1)
  return x * x * (3 - 2 * x)
}

export function secondsPerBar(bpm: number | null | undefined): number {
  const validBpm =
    bpm && Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : FALLBACK_BPM
  return (60 / validBpm) * 4
}

export function transitionDuration(
  bars: BarCount,
  bpm: number | null | undefined,
): { seconds: number; usedFallbackBpm: boolean } {
  const validBpm =
    bpm && Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : FALLBACK_BPM
  return {
    seconds: clamp(secondsPerBar(validBpm) * bars, 1, 180),
    usedFallbackBpm: validBpm !== bpm,
  }
}

/** Nearest beat boundary with a phase offset, used for "snap to beat". */
export function snapToBeat(
  seconds: number,
  bpm: number | null | undefined,
  firstBeat = 0,
  direction: 'nearest' | 'next' = 'nearest',
): number {
  if (!bpm || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return seconds
  const beatLength = 60 / bpm
  const phase = (((seconds - firstBeat) % beatLength) + beatLength) % beatLength
  if (phase < 1e-4) return seconds
  if (direction === 'next') return seconds + (beatLength - phase)
  return phase <= beatLength / 2 ? seconds - phase : seconds + (beatLength - phase)
}

export function nearestBarCount(value: number, minimum = 1): BarCount {
  const bars = [1, 2, 4, 8, 16, 32] as const
  const candidates = bars.filter((bar) => bar >= minimum)
  return candidates.reduce<BarCount>(
    (nearest, bar) => (Math.abs(bar - value) < Math.abs(nearest - value) ? bar : nearest),
    candidates[0] ?? 1,
  )
}

function equalPowerVolume(): { out: number[]; inside: number[] } {
  return {
    out: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
      const p = i / (CURVE_SAMPLES - 1)
      return Math.cos((p * Math.PI) / 2)
    }),
    inside: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
      const p = i / (CURVE_SAMPLES - 1)
      return Math.sin((p * Math.PI) / 2)
    }),
  }
}

export function volumeCurves(
  curve: VolumeCurve,
  preset: TransitionPreset = 'custom',
): { out: number[]; inside: number[] } {
  if (preset === 'rise') {
    return {
      out: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
        const p = i / (CURVE_SAMPLES - 1)
        return 1 - Math.pow(smoothstep(p), 1.35)
      }),
      inside: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
        const p = i / (CURVE_SAMPLES - 1)
        return Math.pow(smoothstep(p), 1.65)
      }),
    }
  }

  if (curve === 'smooth') return equalPowerVolume()

  return {
    out: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
      const p = i / (CURVE_SAMPLES - 1)
      switch (curve) {
        case 'overlap':
          return Math.pow(1 - p, 1.5)
        case 'linear':
          return 1 - p
        case 'cutIn':
          return Math.pow(1 - p, 1.8)
        case 'fadeOutCut':
          return p < 0.72 ? 1 - p / 0.72 : 0
        default:
          return Math.cos((p * Math.PI) / 2)
      }
    }),
    inside: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
      const p = i / (CURVE_SAMPLES - 1)
      switch (curve) {
        case 'overlap':
          return smoothstep(p)
        case 'linear':
          return p
        case 'cutIn':
          return Math.min(1, p * 8)
        case 'fadeOutCut':
          return smoothstep(p)
        default:
          return Math.sin((p * Math.PI) / 2)
      }
    }),
  }
}

export function effectiveCurves(
  preset: TransitionPreset,
  settings: TransitionSettings,
): {
  volume: VolumeCurve
  eq: EqCurve
  filter: FilterCurve
} {
  switch (preset) {
    case 'auto':
      return { volume: 'smooth', eq: 'center', filter: 'none' }
    case 'fade':
      return { volume: 'smooth', eq: 'none', filter: 'none' }
    case 'rise':
      return { volume: 'smooth', eq: 'none', filter: 'lowIn' }
    case 'custom':
    default:
      return {
        volume: settings.volumeCurve,
        eq: settings.eqCurve,
        filter: settings.filterCurve,
      }
  }
}

function eqLowCurves(curve: EqCurve): { out: number[]; inside: number[] } {
  if (curve === 'none') {
    return {
      out: Array.from({ length: CURVE_SAMPLES }, () => 0),
      inside: Array.from({ length: CURVE_SAMPLES }, () => 0),
    }
  }

  return {
    out: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
      const p = i / (CURVE_SAMPLES - 1)
      switch (curve) {
        case 'center':
          return -24 * smoothstep((p - 0.34) / 0.22)
        case 'end':
          return -24 * smoothstep((p - 0.62) / 0.3)
        case 'start':
          return -24 * smoothstep(p / 0.12)
        case 'threeBand':
          return -18 * smoothstep(p)
        case 'quickCut':
          return -24 * smoothstep(p / 0.08)
        default:
          return 0
      }
    }),
    inside: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
      const p = i / (CURVE_SAMPLES - 1)
      switch (curve) {
        case 'center':
          return -24 + 24 * smoothstep((p - 0.38) / 0.28)
        case 'end':
          return 0
        case 'start':
          return -12 + 12 * smoothstep(p / 0.35)
        case 'threeBand':
          return -18 + 18 * smoothstep(p)
        case 'quickCut':
          return 0
        default:
          return 0
      }
    }),
  }
}

function filterCurves(curve: FilterCurve): {
  lowpassOut: number[]
  lowpassIn: number[]
  highpassOut: number[]
  highpassIn: number[]
} {
  const open = 20_000
  const closed = 340
  return {
    lowpassOut: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
      const p = i / (CURVE_SAMPLES - 1)
      if (curve === 'lowOut' || curve === 'lowInLowOut') {
        return open * Math.pow(closed / open, smoothstep(Math.min(1, p / 0.64)))
      }
      return open
    }),
    lowpassIn: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
      const p = i / (CURVE_SAMPLES - 1)
      if (curve === 'lowIn' || curve === 'lowInLowOut' || curve === 'lowInHighOut') {
        return closed * Math.pow(open / closed, smoothstep(Math.min(1, p / 0.72)))
      }
      return open
    }),
    highpassOut: Array.from({ length: CURVE_SAMPLES }, (_, i) => {
      const p = i / (CURVE_SAMPLES - 1)
      if (curve === 'lowInHighOut') {
        return 20 * Math.pow(1_800 / 20, smoothstep(Math.min(1, p / 0.58)))
      }
      return 20
    }),
    highpassIn: Array.from({ length: CURVE_SAMPLES }, () => 20),
  }
}

export function buildTransitionPlan(
  settings: TransitionSettings,
  bpm: number | null | undefined,
  preset: TransitionPreset = settings.preset,
): TransitionPlan {
  const durationInfo = transitionDuration(settings.bars, bpm)
  const curves = effectiveCurves(preset, settings)
  const volumes = volumeCurves(curves.volume, preset)
  const eq = preset === 'rise' ? eqLowCurves('none') : eqLowCurves(curves.eq)
  const filters = filterCurves(preset === 'rise' ? 'lowIn' : curves.filter)

  return {
    duration: durationInfo.seconds,
    usedFallbackBpm: durationInfo.usedFallbackBpm,
    volumeOut: volumes.out,
    volumeIn: volumes.inside,
    eqLowOut: eq.out,
    eqLowIn: eq.inside,
    lowpassOut: filters.lowpassOut,
    lowpassIn: filters.lowpassIn,
    highpassOut: filters.highpassOut,
    highpassIn: filters.highpassIn,
  }
}

/** Computes an equal-power gain pair for the manual crossfader. */
export function crossfaderGains(
  position: number,
  curve: 'equalPower' | 'linear',
): [number, number] {
  const x = clamp(position, 0, 1)
  if (curve === 'linear') return [1 - x, x]
  return [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)]
}

export function nearestBarFromSeconds(seconds: number, bpm: number | null): BarCount {
  const barLength = secondsPerBar(bpm)
  return nearestBarCount(seconds / barLength)
}

export function barsFromDuration(duration: number, bpm: number | null): BarCount {
  const barLength = secondsPerBar(bpm)
  return nearestBarCount(duration / barLength)
}
