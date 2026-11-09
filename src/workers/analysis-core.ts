import type { AnalysisResult } from '../types'
import { toCamelot } from '../lib/keys'

const ANALYSIS_SAMPLE_RATE = 11_025
const BPM_FRAME_SIZE = 1024
const BPM_HOP = 256
const MAX_BPM_SECONDS = 150
const MAX_KEY_SECONDS = 120
const WAVEFORM_BINS = 2000

type ProgressReporter = (progress: number, stage: string) => void

const FFT_SIZE = 4096
const FFT_RE = new Float64Array(FFT_SIZE)
const FFT_IM = new Float64Array(FFT_SIZE)
const HANN = new Float64Array(FFT_SIZE)
for (let i = 0; i < FFT_SIZE; i += 1) {
  HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1))
}

// Krumhansl-Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      const ti = im[i]
      re[i] = re[j] ?? 0
      im[i] = im[j] ?? 0
      re[j] = tr ?? 0
      im[j] = ti ?? 0
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wReal = Math.cos(angle)
    const wImag = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curReal = 1
      let curImag = 0
      for (let j = 0; j < len / 2; j += 1) {
        const evenIndex = i + j
        const oddIndex = i + j + len / 2
        const oddReal = (re[oddIndex] ?? 0) * curReal - (im[oddIndex] ?? 0) * curImag
        const oddImag = (re[oddIndex] ?? 0) * curImag + (im[oddIndex] ?? 0) * curReal
        const evenReal = re[evenIndex] ?? 0
        const evenImag = im[evenIndex] ?? 0
        re[evenIndex] = evenReal + oddReal
        im[evenIndex] = evenImag + oddImag
        re[oddIndex] = evenReal - oddReal
        im[oddIndex] = evenImag - oddImag
        const nextReal = curReal * wReal - curImag * wImag
        curImag = curReal * wImag + curImag * wReal
        curReal = nextReal
      }
    }
  }
}

export function computeWaveformPeaks(samples: Float32Array, bins = WAVEFORM_BINS): number[] {
  if (samples.length === 0) return new Array(bins).fill(0)
  const raw = new Array<number>(bins)
  const bucketSize = samples.length / bins
  let globalPeak = 0
  for (let b = 0; b < bins; b += 1) {
    const start = Math.floor(b * bucketSize)
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((b + 1) * bucketSize)))
    let peak = 0
    let sum = 0
    for (let i = start; i < end; i += 1) {
      const abs = Math.abs(samples[i] ?? 0)
      if (abs > peak) peak = abs
      sum += (samples[i] ?? 0) * (samples[i] ?? 0)
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start))
    const blended = peak * 0.72 + rms * 0.28
    raw[b] = blended
    if (blended > globalPeak) globalPeak = blended
  }
  if (globalPeak < 1e-7) return raw.map(() => 0)

  const sorted = [...raw].sort((a, b) => a - b)
  const nicePeak = Math.max(sorted[Math.floor(bins * 0.985)] ?? globalPeak, globalPeak * 0.35)
  return raw.map((value) => Math.min(1, Math.pow(value / nicePeak, 0.72)))
}

function prepareTempoEnvelope(
  samples: Float32Array,
): { envelope: Float32Array; hopSeconds: number; frameCount: number } | null {
  const frameCount = Math.floor((samples.length - BPM_FRAME_SIZE) / BPM_HOP) + 1
  if (frameCount < 100) return null
  const energy = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * BPM_HOP
    let sum = 0
    for (let i = 0; i < BPM_FRAME_SIZE; i += 1) {
      const value = samples[offset + i] ?? 0
      sum += value * value
    }
    energy[frame] = Math.sqrt(sum / BPM_FRAME_SIZE)
  }

  const envelope = new Float32Array(frameCount)
  let peak = 0
  for (let i = 1; i < frameCount; i += 1) {
    const current = energy[i] ?? 0
    const previous = energy[i - 1] ?? 0
    const diff = Math.max(0, Math.log1p(current * 16) - Math.log1p(previous * 16))
    envelope[i] = diff
    if (diff > peak) peak = diff
  }
  if (peak < 1e-5) return null
  for (let i = 0; i < frameCount; i += 1) envelope[i] = (envelope[i] ?? 0) / peak

  return {
    envelope,
    hopSeconds: BPM_HOP / ANALYSIS_SAMPLE_RATE,
    frameCount,
  }
}

export function estimateBpm(samples: Float32Array): {
  bpm: number
  confidence: number
  firstBeat: number
} {
  const prepared = prepareTempoEnvelope(samples)
  if (!prepared) return { bpm: 0, confidence: 0, firstBeat: 0 }
  const { envelope, hopSeconds, frameCount } = prepared

  const minLag = Math.max(4, Math.floor(60 / 200 / hopSeconds))
  const maxLag = Math.min(frameCount - 2, Math.ceil(60 / 55 / hopSeconds))
  const correlations = new Float32Array(maxLag + 2)
  let totalEnergy = 0
  for (let i = 0; i < frameCount; i += 1) totalEnergy += (envelope[i] ?? 0) ** 2

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let product = 0
    let energyA = 0
    let energyB = 0
    for (let i = 0; i + lag < frameCount; i += 1) {
      const a = envelope[i] ?? 0
      const b = envelope[i + lag] ?? 0
      product += a * b
      energyA += a * a
      energyB += b * b
    }
    const denom = Math.sqrt(energyA * energyB)
    correlations[lag] = denom > 1e-9 ? product / denom : 0
  }

  let bestLag = minLag
  let bestRawScore = -1
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const score = correlations[lag] ?? 0
    if (score > (correlations[lag - 1] ?? 0) && score >= (correlations[lag + 1] ?? 0)) {
      if (score > bestRawScore) {
        bestRawScore = score
        bestLag = lag
      }
    }
  }
  if (bestRawScore <= 0) {
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      if ((correlations[lag] ?? 0) > bestRawScore) {
        bestRawScore = correlations[lag] ?? 0
        bestLag = lag
      }
    }
  }

  if (bestRawScore < 0.055) return { bpm: 0, confidence: bestRawScore, firstBeat: 0 }

  // Refine the integer lag with a parabola around the autocorrelation peak.
  const y0 = Math.log1p(Math.max(0, correlations[bestLag - 1] ?? 0))
  const y1 = Math.log1p(Math.max(0, correlations[bestLag] ?? 0))
  const y2 = Math.log1p(Math.max(0, correlations[bestLag + 1] ?? 0))
  const denominator = 2 * (2 * y1 - y0 - y2)
  const offset = denominator !== 0 ? (y2 - y0) / denominator : 0
  const refinedLag = bestLag + Math.max(-0.45, Math.min(0.45, offset))

  let bpm = 60 / (refinedLag * hopSeconds)
  // Fold octave ambiguities toward the most common DJ tempo range.
  while (bpm < 70) bpm *= 2
  while (bpm > 180) bpm /= 2

  // Some material has a strong half-time peak. Prefer a 2x reading when its
  // harmonic energy is comparable and it lands in a more typical range.
  if (bpm < 90) {
    const doubleBpm = bpm * 2
    if (doubleBpm <= 180) bpm = doubleBpm
  }

  const periodFrames = 60 / bpm / hopSeconds
  let bestPhase = 0
  let bestPhaseScore = -1
  const phaseSteps = Math.max(1, Math.round(periodFrames * 4))
  for (let step = 0; step < phaseSteps; step += 1) {
    const phase = (step / phaseSteps) * periodFrames
    let score = 0
    let count = 0
    for (let pos = phase; pos < frameCount; pos += periodFrames) {
      const index = Math.round(pos)
      if (index >= 0 && index < frameCount) {
        score += envelope[index] ?? 0
        count += 1
      }
    }
    const normalized = count > 0 ? score / count : 0
    if (normalized > bestPhaseScore) {
      bestPhaseScore = normalized
      bestPhase = phase
    }
  }

  const confidence = Math.min(
    1,
    (bestRawScore / Math.max(1e-5, totalEnergy / Math.max(1, frameCount))) * 0.7,
  )

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence,
    firstBeat: bestPhase * hopSeconds,
  }
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let sumA = 0
  let sumB = 0
  for (let i = 0; i < n; i += 1) {
    sumA += a[i] ?? 0
    sumB += b[i] ?? 0
  }
  const meanA = sumA / n
  const meanB = sumB / n
  let num = 0
  let denomA = 0
  let denomB = 0
  for (let i = 0; i < n; i += 1) {
    const va = (a[i] ?? 0) - meanA
    const vb = (b[i] ?? 0) - meanB
    num += va * vb
    denomA += va * va
    denomB += vb * vb
  }
  return denomA > 1e-9 && denomB > 1e-9 ? num / Math.sqrt(denomA * denomB) : 0
}

export function detectKey(samples: Float32Array): {
  musicalKey: string
  camelot: string
  mode: 'major' | 'minor' | null
  root: string | null
  confidence: number
} {
  const hop = FFT_SIZE
  const maxSamples = Math.min(samples.length, ANALYSIS_SAMPLE_RATE * MAX_KEY_SECONDS)
  const chroma = new Array<number>(12).fill(0)
  let analysed = 0
  let weightedFrames = 0
  const minFrequency = 55
  const maxFrequency = 2_100
  while (analysed + FFT_SIZE <= maxSamples) {
    let energy = 0
    for (let i = 0; i < FFT_SIZE; i += 1) {
      const sample = samples[analysed + i] ?? 0
      energy += sample * sample
    }
    const rms = Math.sqrt(energy / FFT_SIZE)
    if (rms > 0.004) {
      for (let i = 0; i < FFT_SIZE; i += 1) {
        FFT_RE[i] = (samples[analysed + i] ?? 0) * (HANN[i] ?? 0)
        FFT_IM[i] = 0
      }
      fft(FFT_RE, FFT_IM)
      const weight = Math.min(1, Math.log1p(rms * 60))
      for (let bin = 1; bin < FFT_SIZE / 2; bin += 1) {
        const frequency = (bin * ANALYSIS_SAMPLE_RATE) / FFT_SIZE
        if (frequency < minFrequency || frequency > maxFrequency) continue
        const magnitude = Math.hypot(FFT_RE[bin] ?? 0, FFT_IM[bin] ?? 0)
        if (magnitude <= 0.0001) continue
        const midi = 69 + 12 * Math.log2(frequency / 440)
        const pitchClass = ((Math.round(midi) % 12) + 12) % 12
        chroma[pitchClass] = (chroma[pitchClass] ?? 0) + Math.pow(magnitude, 0.62) * weight
      }
      weightedFrames += 1
    }
    analysed += hop
  }

  if (weightedFrames === 0) {
    return {
      musicalKey: '—',
      camelot: '—',
      mode: null,
      root: null,
      confidence: 0,
    }
  }

  const mean = chroma.reduce((a, b) => a + b, 0) / 12
  if (mean < 1e-9) {
    return {
      musicalKey: '—',
      camelot: '—',
      mode: null,
      root: null,
      confidence: 0,
    }
  }

  let bestScore = -Infinity
  let secondScore = -Infinity
  let bestRoot = 0
  let bestMode: 'major' | 'minor' = 'major'

  for (let root = 0; root < 12; root += 1) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE
      const rotated = Array.from({ length: 12 }, (_, interval) => {
        return chroma[(root + interval) % 12] ?? 0
      })
      const score = pearson(rotated, profile)
      if (score > bestScore) {
        secondScore = bestScore
        bestScore = score
        bestRoot = root
        bestMode = mode
      } else if (score > secondScore) {
        secondScore = score
      }
    }
  }

  if (bestScore < 0.08) {
    return {
      musicalKey: '—',
      camelot: '—',
      mode: null,
      root: null,
      confidence: 0,
    }
  }

  const root = SHARP_NOTES[bestRoot] ?? 'C'
  const modeLabel = bestMode === 'major' ? 'maj' : 'min'
  return {
    musicalKey: `${root} ${modeLabel}`,
    camelot: toCamelot(root, bestMode),
    mode: bestMode,
    root,
    confidence: Math.max(0, Math.min(1, bestScore - Math.max(0, secondScore))),
  }
}

export interface AnalysisProgress {
  progress: number
  stage: string
}

/**
 * Analysis is deterministic and CPU-only. It runs inside a dedicated worker so
 * decode/analysis never blocks touch input or waveform rendering.
 */
export function analyseSamples(
  samples: Float32Array,
  duration: number,
  report: ProgressReporter = () => {},
): AnalysisResult {
  report(0.05, 'Forma d’onda')
  const peaks = computeWaveformPeaks(samples)

  report(0.3, 'Rilevamento BPM')
  const tempoSamples = samples.slice(
    0,
    Math.min(samples.length, ANALYSIS_SAMPLE_RATE * MAX_BPM_SECONDS),
  )
  const tempo = estimateBpm(tempoSamples)

  report(0.68, 'Tonalità')
  const keySamples = samples.slice(
    0,
    Math.min(samples.length, ANALYSIS_SAMPLE_RATE * MAX_KEY_SECONDS),
  )
  const key = detectKey(keySamples)

  let sumSquares = 0
  const step = Math.max(1, Math.floor(samples.length / 80_000))
  let counted = 0
  for (let i = 0; i < samples.length; i += step) {
    sumSquares += (samples[i] ?? 0) ** 2
    counted += 1
  }

  report(0.96, 'Ottimizzazione cache')
  report(1, 'Completato')

  return {
    bpm: tempo.bpm,
    bpmConfidence: tempo.confidence,
    firstBeat: tempo.firstBeat,
    musicalKey: key.musicalKey,
    camelot: key.camelot,
    keyConfidence: key.confidence,
    peaks,
    rms: Math.sqrt(sumSquares / Math.max(1, counted)),
    analysedSeconds: Math.min(duration, MAX_KEY_SECONDS),
  }
}

export { ANALYSIS_SAMPLE_RATE, WAVEFORM_BINS }
