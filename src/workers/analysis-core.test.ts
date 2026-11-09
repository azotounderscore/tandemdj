import { describe, expect, it } from 'vitest'
import { ANALYSIS_SAMPLE_RATE, computeWaveformPeaks, estimateBpm } from './analysis-core'

function clickTrack(bpm: number, seconds = 26): Float32Array {
  const rate = ANALYSIS_SAMPLE_RATE
  const samples = new Float32Array(Math.floor(rate * seconds))
  const beatSeconds = 60 / bpm
  let seed = 1234567
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff
  }
  for (let beat = 0; beat * beatSeconds < seconds; beat += 1) {
    const offset = Math.floor(beat * beatSeconds * rate)
    const length = Math.floor(rate * 0.035)
    for (let i = 0; i < length; i += 1) {
      const decay = Math.exp(-i / (rate * 0.006))
      const tone = Math.sin((2 * Math.PI * 180 * i) / rate)
      const noise = random() * 2 - 1
      samples[offset + i] = (tone * 0.55 + noise * 0.2) * decay
    }
  }
  return samples
}

describe('tempo analysis', () => {
  it('detects a steady 128 BPM pulse', () => {
    const result = estimateBpm(clickTrack(128))
    expect(result.bpm).toBeGreaterThan(124)
    expect(result.bpm).toBeLessThan(132)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.firstBeat).toBeGreaterThanOrEqual(0)
  })

  it('returns zero for silence', () => {
    expect(estimateBpm(new Float32Array(ANALYSIS_SAMPLE_RATE * 10))).toEqual({
      bpm: 0,
      confidence: 0,
      firstBeat: 0,
    })
  })
})

describe('waveform analysis', () => {
  it('normalises peaks and reflects amplitude changes', () => {
    const samples = new Float32Array(ANALYSIS_SAMPLE_RATE * 4)
    for (let i = 0; i < samples.length; i += 1) {
      const half = i < samples.length / 2
      samples[i] = Math.sin((2 * Math.PI * 200 * i) / ANALYSIS_SAMPLE_RATE) * (half ? 0.12 : 0.8)
    }
    const peaks = computeWaveformPeaks(samples, 80)
    expect(peaks).toHaveLength(80)
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...peaks)).toBeLessThanOrEqual(1)
    const firstHalf = peaks.slice(0, 30)
    const secondHalf = peaks.slice(50)
    expect(Math.max(...secondHalf)).toBeGreaterThan(Math.max(...firstHalf))
  })

  it('returns a zeroed waveform for silence', () => {
    const peaks = computeWaveformPeaks(new Float32Array(1000), 16)
    expect(peaks).toEqual(new Array(16).fill(0))
  })
})
