import { describe, expect, it } from 'vitest'
import type { TransitionSettings } from '../types'
import {
  CURVE_SAMPLES,
  barsFromDuration,
  buildTransitionPlan,
  crossfaderGains,
  effectiveCurves,
  nearestBarCount,
  secondsPerBar,
  snapToBeat,
  transitionDuration,
  volumeCurves,
} from './transitions'

const base: TransitionSettings = {
  preset: 'auto',
  bars: 16,
  volumeCurve: 'smooth',
  eqCurve: 'center',
  filterCurve: 'none',
  autoMix: false,
  snapToBeat: true,
}

describe('transition timing', () => {
  it('derives bar and transition lengths from BPM', () => {
    expect(secondsPerBar(120)).toBe(2)
    expect(secondsPerBar(128)).toBeCloseTo(1.875)
    expect(transitionDuration(16, 128)).toEqual({ seconds: 30, usedFallbackBpm: false })
    expect(transitionDuration(16, null)).toEqual({ seconds: 32, usedFallbackBpm: true })
  })

  it('clamps invalid BPM values to the fallback', () => {
    expect(secondsPerBar(12)).toBe(2)
    expect(secondsPerBar(Number.NaN)).toBe(2)
    expect(transitionDuration(1, 500).usedFallbackBpm).toBe(true)
  })

  it('snaps to the nearest beat with a phase offset', () => {
    expect(snapToBeat(2.2, 120)).toBe(2)
    expect(snapToBeat(2.4, 120)).toBe(2.5)
    expect(snapToBeat(2.2, 120, 0, 'next')).toBeCloseTo(2.5)
    expect(snapToBeat(2.31, 120, 0.1)).toBeCloseTo(2.1)
    expect(snapToBeat(1.234, null)).toBe(1.234)
  })

  it('rounds durations to the nearest selectable bar count', () => {
    expect(nearestBarCount(16)).toBe(16)
    expect(nearestBarCount(3)).toBe(2)
    expect(nearestBarCount(30)).toBe(32)
    expect(nearestBarCount(1, 4)).toBe(4)
    expect(barsFromDuration(30, 120)).toBe(16)
  })
})

describe('transition curves', () => {
  it('creates equal-power smooth curves with matching endpoints', () => {
    const { out, inside } = volumeCurves('smooth')
    expect(out).toHaveLength(CURVE_SAMPLES)
    expect(inside).toHaveLength(CURVE_SAMPLES)
    expect(out[0]).toBeCloseTo(1)
    expect(out.at(-1)).toBeCloseTo(0)
    expect(inside[0]).toBeCloseTo(0)
    expect(inside.at(-1)).toBeCloseTo(1)
    expect(out[32]).toBeCloseTo(Math.SQRT1_2, 2)
  })

  it('swaps the bass at the centre for Auto', () => {
    const plan = buildTransitionPlan(base, 120)
    expect(plan.duration).toBe(32)
    expect(plan.usedFallbackBpm).toBe(false)
    expect(plan.eqLowOut[0]).toBeCloseTo(0)
    expect(plan.eqLowOut.at(-1)).toBeCloseTo(-24)
    expect(plan.eqLowIn[0]).toBeCloseTo(-24)
    expect(plan.eqLowIn.at(-1)).toBeCloseTo(0)
    expect(plan.volumeOut[0]).toBeCloseTo(1)
    expect(plan.volumeIn.at(-1)).toBeCloseTo(1)
  })

  it('keeps Fade free of EQ and applies the Rise low-pass', () => {
    const fade = buildTransitionPlan({ ...base, preset: 'fade' }, 120)
    expect(fade.eqLowOut.every((value) => value === 0)).toBe(true)
    expect(fade.lowpassIn[0]).toBe(20_000)

    const rise = buildTransitionPlan({ ...base, preset: 'rise' }, 120)
    expect(rise.lowpassIn[0]).toBeCloseTo(340)
    expect(rise.lowpassIn.at(-1)).toBeCloseTo(20_000)
    expect(rise.eqLowOut.every((value) => value === 0)).toBe(true)
  })

  it('uses custom selections only for the Custom preset', () => {
    const custom = {
      ...base,
      preset: 'custom' as const,
      volumeCurve: 'linear' as const,
      eqCurve: 'none' as const,
      filterCurve: 'lowOut' as const,
    }
    expect(effectiveCurves('auto', custom)).toEqual({
      volume: 'smooth',
      eq: 'center',
      filter: 'none',
    })
    expect(effectiveCurves('custom', custom)).toEqual({
      volume: 'linear',
      eq: 'none',
      filter: 'lowOut',
    })
    expect(buildTransitionPlan(custom, 120).lowpassOut.at(-1)).toBeCloseTo(340)
  })

  it('maps the manual crossfader with both curves', () => {
    expect(crossfaderGains(0, 'linear')).toEqual([1, 0])
    expect(crossfaderGains(1, 'linear')).toEqual([0, 1])
    const [left, right] = crossfaderGains(0.5, 'equalPower')
    expect(left).toBeCloseTo(Math.SQRT1_2)
    expect(right).toBeCloseTo(Math.SQRT1_2)
    expect(crossfaderGains(2, 'linear')).toEqual([0, 1])
  })
})
