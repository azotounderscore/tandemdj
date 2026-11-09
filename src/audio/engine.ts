import type { DeckControls, DeckId, TransitionPlan } from '../types'
import { clamp } from '../lib/format'
import { crossfaderGains } from '../lib/transitions'

type EngineEvent =
  | { type: 'deckEnded'; deck: DeckId }
  | { type: 'transitionEnded'; from: DeckId; to: DeckId }
  | { type: 'contextState'; state: AudioContextState }
  | { type: 'error'; message: string }

type EngineListener = (event: EngineEvent) => void

interface TransitionRuntime {
  from: DeckId
  to: DeckId
  startedAt: number
  endsAt: number
  duration: number
  clock: OscillatorNode
  cancelled: boolean
}

interface DeckGraph {
  gate: GainNode
  trim: GainNode
  eqLow: BiquadFilterNode
  eqMid: BiquadFilterNode
  eqHigh: BiquadFilterNode
  transitionLow: BiquadFilterNode
  transitionLowpass: BiquadFilterNode
  transitionHighpass: BiquadFilterNode
  userLowpass: BiquadFilterNode
  volume: GainNode
  fader: GainNode
}

interface DeckState {
  graph: DeckGraph | null
  buffer: AudioBuffer | null
  source: AudioBufferSourceNode | null
  playing: boolean
  generation: number
  startedAt: number
  offsetAtStart: number
  controls: DeckControls
  manualStop: boolean
}

const DEFAULT_CONTROLS: DeckControls = {
  volume: 0.82,
  gainDb: 0,
  lowDb: 0,
  midDb: 0,
  highDb: 0,
  filter: 0,
  cuePoint: 0,
}

const MAX_AUDIO_SECONDS = 900

function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

function filterFrequency(value: number): number {
  const v = clamp(value, 0, 1)
  return 20_000 * Math.pow(180 / 20_000, v)
}

function filterQ(value: number): number {
  return 0.7 + clamp(value, 0, 1) * 4.5
}

function curve(values: number[]): Float32Array {
  return Float32Array.from(values)
}

function smoothParam(param: AudioParam, value: number, now: number, time = 0.025): void {
  param.cancelScheduledValues(now)
  param.setTargetAtTime(value, now, time)
}

export class AudioEngine {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private activeTransition: TransitionRuntime | null = null
  private listeners = new Set<EngineListener>()
  private decks: Record<DeckId, DeckState> = {
    A: {
      graph: null,
      buffer: null,
      source: null,
      playing: false,
      generation: 0,
      startedAt: 0,
      offsetAtStart: 0,
      controls: { ...DEFAULT_CONTROLS },
      manualStop: false,
    },
    B: {
      graph: null,
      buffer: null,
      source: null,
      playing: false,
      generation: 0,
      startedAt: 0,
      offsetAtStart: 0,
      controls: { ...DEFAULT_CONTROLS },
      manualStop: false,
    },
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[audio] listener error', error)
      }
    }
  }

  getContextState(): AudioContextState | 'uninitialised' {
    return this.context?.state ?? 'uninitialised'
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context
    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) {
      throw new Error('Web Audio API non supportata da questo browser')
    }
    const context = new AudioContextCtor({ latencyHint: 'interactive' })
    const master = context.createGain()
    master.gain.value = 0.9
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -8
    compressor.knee.value = 4
    compressor.ratio.value = 10
    compressor.attack.value = 0.003
    compressor.release.value = 0.24
    master.connect(compressor)
    compressor.connect(context.destination)
    this.context = context
    this.master = master

    for (const id of ['A', 'B'] as const) {
      this.decks[id].graph = this.createDeckGraph(id)
    }

    context.addEventListener('statechange', () => {
      this.emit({ type: 'contextState', state: context.state })
    })

    this.applyControls('A', this.decks.A.controls, true)
    this.applyControls('B', this.decks.B.controls, true)
    this.setCrossfader('A', 0, 'equalPower')
    return context
  }

  private createDeckGraph(deck: DeckId): DeckGraph {
    const context = this.context
    const master = this.master
    if (!context || !master) throw new Error('Audio engine non inizializzato')

    const gate = context.createGain()
    gate.gain.value = 0
    const trim = context.createGain()
    const eqLow = context.createBiquadFilter()
    eqLow.type = 'lowshelf'
    eqLow.frequency.value = 160
    const eqMid = context.createBiquadFilter()
    eqMid.type = 'peaking'
    eqMid.frequency.value = 1_200
    eqMid.Q.value = 0.8
    const eqHigh = context.createBiquadFilter()
    eqHigh.type = 'highshelf'
    eqHigh.frequency.value = 4_200

    const transitionLow = context.createBiquadFilter()
    transitionLow.type = 'lowshelf'
    transitionLow.frequency.value = 180
    transitionLow.gain.value = 0

    const transitionLowpass = context.createBiquadFilter()
    transitionLowpass.type = 'lowpass'
    transitionLowpass.frequency.value = 20_000
    transitionLowpass.Q.value = 0.8

    const transitionHighpass = context.createBiquadFilter()
    transitionHighpass.type = 'highpass'
    transitionHighpass.frequency.value = 20
    transitionHighpass.Q.value = 0.7

    const userLowpass = context.createBiquadFilter()
    userLowpass.type = 'lowpass'
    userLowpass.frequency.value = 20_000
    userLowpass.Q.value = 0.7

    const volume = context.createGain()
    volume.gain.value = this.decks[deck].controls.volume
    const fader = context.createGain()
    fader.gain.value = deck === 'A' ? 1 : 0

    gate.connect(trim)
    trim.connect(eqLow)
    eqLow.connect(eqMid)
    eqMid.connect(eqHigh)
    eqHigh.connect(transitionLow)
    transitionLow.connect(transitionLowpass)
    transitionLowpass.connect(transitionHighpass)
    transitionHighpass.connect(userLowpass)
    userLowpass.connect(volume)
    volume.connect(fader)
    fader.connect(master)

    return {
      gate,
      trim,
      eqLow,
      eqMid,
      eqHigh,
      transitionLow,
      transitionLowpass,
      transitionHighpass,
      userLowpass,
      volume,
      fader,
    }
  }

  async unlock(): Promise<AudioContextState> {
    const context = this.ensureContext()
    if (context.state === 'suspended') {
      try {
        await context.resume()
      } catch {
        this.emit({
          type: 'error',
          message: 'Tocca di nuovo il play per autorizzare l’audio su questo dispositivo.',
        })
      }
    }
    return context.state
  }

  async decode(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    if (!arrayBuffer.byteLength) throw new Error('Il file audio è vuoto')
    const context = this.ensureContext()
    const copy = arrayBuffer.slice(0)
    let buffer: AudioBuffer
    try {
      buffer = await context.decodeAudioData(copy)
    } catch {
      throw new Error('Formato audio non supportato o file danneggiato')
    }
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
      throw new Error('Il file non contiene audio riproducibile')
    }
    if (buffer.duration > MAX_AUDIO_SECONDS) {
      throw new Error('Brano troppo lungo: il limite è 15 minuti per deck')
    }
    return buffer
  }

  loadBuffer(deck: DeckId, buffer: AudioBuffer): void {
    this.ensureContext()
    const state = this.decks[deck]
    this.hardStop(deck)
    state.buffer = buffer
    state.offsetAtStart = 0
    state.playing = false
    if (!state.graph) return
    state.graph.gate.gain.cancelScheduledValues(this.context?.currentTime ?? 0)
    state.graph.gate.gain.value = 0
    this.resetTransitionNodes(deck)
  }

  private resetTransitionNodes(deck: DeckId): void {
    const context = this.context
    const graph = this.decks[deck].graph
    if (!context || !graph) return
    const now = context.currentTime
    for (const param of [
      graph.transitionLow.gain,
      graph.transitionLowpass.frequency,
      graph.transitionHighpass.frequency,
    ]) {
      param.cancelScheduledValues(now)
    }
    graph.transitionLow.gain.setValueAtTime(0, now)
    graph.transitionLowpass.frequency.setValueAtTime(20_000, now)
    graph.transitionHighpass.frequency.setValueAtTime(20, now)
  }

  async play(deck: DeckId, offset?: number, when?: number): Promise<boolean> {
    const context = this.ensureContext()
    if (context.state === 'suspended') {
      await this.unlock()
      if (this.context?.state === 'suspended') return false
    }
    const state = this.decks[deck]
    if (!state.buffer || !state.graph) return false
    if (state.playing) return true
    const now = context.currentTime
    const startAt = Math.max(now + 0.01, when ?? now + 0.025)
    const position = clamp(
      offset ?? state.offsetAtStart,
      0,
      Math.max(0, state.buffer.duration - 0.02),
    )
    const source = context.createBufferSource()
    source.buffer = state.buffer
    source.connect(state.graph.gate)
    const generation = ++state.generation
    state.manualStop = false
    source.onended = () => {
      if (generation !== state.generation) return
      if (this.decks[deck].manualStop) return
      state.playing = false
      state.source = null
      state.offsetAtStart = state.buffer?.duration ?? 0
      state.graph?.gate.gain.setValueAtTime(0, context.currentTime)
      this.emit({ type: 'deckEnded', deck })
    }
    state.graph.gate.gain.cancelScheduledValues(now)
    state.graph.gate.gain.setValueAtTime(0, now)
    state.graph.gate.gain.linearRampToValueAtTime(1, startAt + 0.012)
    source.start(startAt, position)
    state.source = source
    state.playing = true
    state.startedAt = startAt
    state.offsetAtStart = position
    return true
  }

  pause(deck: DeckId): number {
    const state = this.decks[deck]
    const position = this.getPosition(deck)
    this.stopSource(deck)
    state.offsetAtStart = position
    state.playing = false
    state.manualStop = true
    return position
  }

  stop(deck: DeckId): void {
    this.hardStop(deck)
    const state = this.decks[deck]
    state.offsetAtStart = 0
    state.playing = false
  }

  private stopSource(deck: DeckId): void {
    const context = this.context
    const state = this.decks[deck]
    if (!context || !state.graph) return
    const now = context.currentTime
    state.generation += 1
    state.manualStop = true
    if (state.source) {
      const source = state.source
      state.graph.gate.gain.cancelScheduledValues(now)
      state.graph.gate.gain.setValueAtTime(state.graph.gate.gain.value, now)
      state.graph.gate.gain.linearRampToValueAtTime(0, now + 0.02)
      try {
        source.stop(now + 0.025)
      } catch {
        // The source may already have stopped naturally.
      }
      window.setTimeout(() => {
        try {
          source.disconnect()
        } catch {
          // Already disconnected.
        }
      }, 80)
      state.source = null
    }
  }

  private hardStop(deck: DeckId): void {
    const state = this.decks[deck]
    state.generation += 1
    state.manualStop = true
    if (state.source) {
      try {
        state.source.stop()
        state.source.disconnect()
      } catch {
        // Source already stopped.
      }
      state.source = null
    }
    if (state.graph && this.context) {
      state.graph.gate.gain.cancelScheduledValues(this.context.currentTime)
      state.graph.gate.gain.setValueAtTime(0, this.context.currentTime)
    }
    state.playing = false
  }

  seek(deck: DeckId, position: number): void {
    const state = this.decks[deck]
    if (!state.buffer) return
    const target = clamp(position, 0, Math.max(0, state.buffer.duration - 0.02))
    if (state.playing) {
      this.stopSource(deck)
      state.offsetAtStart = target
      state.playing = false
      state.manualStop = false
      void this.play(deck, target)
    } else {
      state.offsetAtStart = target
    }
  }

  getPosition(deck: DeckId): number {
    const state = this.decks[deck]
    if (!state.buffer) return 0
    const context = this.context
    if (!state.playing || !context) return clamp(state.offsetAtStart, 0, state.buffer.duration)
    const elapsed = Math.max(0, context.currentTime - state.startedAt)
    return clamp(state.offsetAtStart + elapsed, 0, state.buffer.duration)
  }

  getDuration(deck: DeckId): number {
    return this.decks[deck].buffer?.duration ?? 0
  }

  isPlaying(deck: DeckId): boolean {
    return this.decks[deck].playing
  }

  isLoaded(deck: DeckId): boolean {
    return this.decks[deck].buffer !== null
  }

  setControls(deck: DeckId, controls: DeckControls): void {
    this.decks[deck].controls = { ...controls }
    this.applyControls(deck, controls)
  }

  private applyControls(deck: DeckId, controls: DeckControls, immediate = false): void {
    const context = this.context
    const graph = this.decks[deck].graph
    if (!context || !graph) return
    const now = context.currentTime
    const set = (param: AudioParam, value: number) => {
      if (immediate) param.value = value
      else smoothParam(param, value, now)
    }
    set(graph.volume.gain, clamp(controls.volume, 0, 1))
    set(graph.trim.gain, dbToGain(clamp(controls.gainDb, -12, 12)))
    set(graph.eqLow.gain, clamp(controls.lowDb, -18, 12))
    set(graph.eqMid.gain, clamp(controls.midDb, -18, 12))
    set(graph.eqHigh.gain, clamp(controls.highDb, -18, 12))
    set(graph.userLowpass.frequency, filterFrequency(controls.filter))
    set(graph.userLowpass.Q, filterQ(controls.filter))
  }

  setMasterVolume(value: number): void {
    if (!this.context || !this.master) {
      this.ensureContext()
    }
    if (!this.context || !this.master) return
    smoothParam(this.master.gain, clamp(value, 0, 1), this.context.currentTime, 0.03)
  }

  setCrossfader(
    currentDeck: DeckId,
    position: number,
    curve: 'equalPower' | 'linear',
    immediate = false,
  ): void {
    if (!this.context) this.ensureContext()
    const context = this.context
    if (!context) return
    const x = clamp(position, 0, 1)
    const physicalX = currentDeck === 'A' ? x : 1 - x
    const [gainA, gainB] = crossfaderGains(physicalX, curve)
    const now = context.currentTime
    for (const [deck, gain] of [
      ['A', gainA],
      ['B', gainB],
    ] as const) {
      const graph = this.decks[deck].graph
      if (!graph) continue
      graph.fader.gain.cancelScheduledValues(now)
      if (immediate) {
        graph.fader.gain.setValueAtTime(gain, now)
      } else {
        graph.fader.gain.setTargetAtTime(gain, now, 0.018)
      }
    }
  }

  getActiveTransition(): { from: DeckId; to: DeckId; progress: number; endsAt: number } | null {
    if (!this.activeTransition || !this.context) return null
    const transition = this.activeTransition
    const now = this.context.currentTime
    return {
      from: transition.from,
      to: transition.to,
      progress: clamp((now - transition.startedAt) / transition.duration, 0, 1),
      endsAt: transition.endsAt,
    }
  }

  async startTransition(
    from: DeckId,
    to: DeckId,
    plan: TransitionPlan,
    options: { incomingOffset?: number; delayBeats?: number } = {},
  ): Promise<{ startedAt: number; endsAt: number; duration: number } | null> {
    const context = this.ensureContext()
    if (context.state === 'suspended') {
      await this.unlock()
    }
    if (!this.decks[from].buffer || !this.decks[to].buffer) {
      throw new Error('Servono due brani per avviare una transizione')
    }
    if (this.activeTransition) {
      throw new Error('Una transizione è già in corso')
    }
    const start = context.currentTime + Math.max(0, options.delayBeats ?? 0) + 0.04
    const duration = clamp(plan.duration, 1, 180)
    const end = start + duration

    // Start the incoming deck exactly with the automation. The automation is
    // sample-scheduled on the audio clock, so neither timing nor fades depend
    // on main-thread setInterval calls.
    await this.play(to, options.incomingOffset ?? 0, start)
    if (!this.decks[to].playing) {
      throw new Error('Impossibile avviare il deck successivo')
    }

    const fromGraph = this.decks[from].graph
    const toGraph = this.decks[to].graph
    if (!fromGraph || !toGraph) throw new Error('Grafo audio non disponibile')

    const applyCurve = (param: AudioParam, values: number[]) => {
      if (values.length < 2) return
      param.cancelScheduledValues(context.currentTime)
      // A single setValueCurveAtTime call is atomic and avoids stacked ramps.
      param.setValueCurveAtTime(curve(values), start, duration)
    }

    applyCurve(fromGraph.fader.gain, plan.volumeOut)
    applyCurve(toGraph.fader.gain, plan.volumeIn)
    applyCurve(fromGraph.transitionLow.gain, plan.eqLowOut)
    applyCurve(toGraph.transitionLow.gain, plan.eqLowIn)
    applyCurve(fromGraph.transitionLowpass.frequency, plan.lowpassOut)
    applyCurve(toGraph.transitionLowpass.frequency, plan.lowpassIn)
    applyCurve(fromGraph.transitionHighpass.frequency, plan.highpassOut)
    applyCurve(toGraph.transitionHighpass.frequency, plan.highpassIn)

    const clockGain = context.createGain()
    clockGain.gain.value = 0
    const clock = context.createOscillator()
    clock.frequency.value = 20
    clock.connect(clockGain)
    clockGain.connect(context.destination)
    clock.start(start)
    clock.stop(end)

    const runtime: TransitionRuntime = {
      from,
      to,
      startedAt: start,
      endsAt: end,
      duration,
      clock,
      cancelled: false,
    }
    this.activeTransition = runtime
    clock.onended = () => {
      try {
        clock.disconnect()
        clockGain.disconnect()
      } catch {
        // Already disconnected.
      }
      if (runtime.cancelled) return
      this.activeTransition = null
      this.resetTransitionNodes(from)
      this.resetTransitionNodes(to)
      this.emit({ type: 'transitionEnded', from, to })
    }

    return { startedAt: start, endsAt: end, duration }
  }

  cancelTransition(): void {
    const transition = this.activeTransition
    if (!transition || !this.context) return
    transition.cancelled = true
    try {
      transition.clock.stop()
      transition.clock.disconnect()
    } catch {
      // Clock already finished.
    }
    this.activeTransition = null
    this.resetTransitionNodes(transition.from)
    this.resetTransitionNodes(transition.to)
    const currentDeck = transition.to
    this.setCrossfader(currentDeck, 1, 'equalPower', true)
  }

  /**
   * Fades a deck out over a short period for safe stops and mode changes.
   * AudioParam automation is used; no interval-based volume writes.
   */
  fadeOut(deck: DeckId, duration = 0.12): void {
    const context = this.context
    const state = this.decks[deck]
    if (!context || !state.graph) return
    const now = context.currentTime
    const graph = state.graph
    graph.fader.gain.cancelScheduledValues(now)
    graph.fader.gain.setValueAtTime(graph.fader.gain.value, now)
    graph.fader.gain.linearRampToValueAtTime(0, now + duration)
  }

  releaseDeck(deck: DeckId): void {
    this.hardStop(deck)
    const state = this.decks[deck]
    state.buffer = null
    state.offsetAtStart = 0
    this.resetTransitionNodes(deck)
  }

  releaseAll(): void {
    this.cancelTransition()
    this.releaseDeck('A')
    this.releaseDeck('B')
  }

  async suspend(): Promise<void> {
    if (this.context?.state === 'running') {
      try {
        await this.context.suspend()
      } catch {
        // Some browsers refuse to suspend during active media playback.
      }
    }
  }

  async resume(): Promise<void> {
    await this.unlock()
  }

  dispose(): void {
    this.cancelTransition()
    for (const deck of ['A', 'B'] as const) this.hardStop(deck)
    this.listeners.clear()
    if (this.context) {
      void this.context.close()
      this.context = null
      this.master = null
    }
  }
}

export const audioEngine = new AudioEngine()
