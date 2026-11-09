import type { DeckId, TransitionPlan, YouTubePlayerLike } from '../types'
import { clamp } from '../lib/format'
import { crossfaderGains } from '../lib/transitions'

export type YouTubePlayerState =
  'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued' | 'unknown'

type YouTubeEngineEvent =
  | { type: 'ready'; deck: DeckId }
  | { type: 'state'; deck: DeckId; state: YouTubePlayerState }
  | { type: 'error'; deck?: DeckId; message: string }
  | { type: 'transitionProgress'; from: DeckId; to: DeckId; progress: number }
  | { type: 'transitionEnded'; from: DeckId; to: DeckId }

interface YouTubePlayerEvent {
  target: YouTubePlayerLike
  data?: number
}

interface YouTubePlayerConfig {
  videoId: string
  host?: string
  width: string
  height: string
  playerVars: Record<string, string | number>
  events: {
    onReady: (event: YouTubePlayerEvent) => void
    onStateChange: (event: YouTubePlayerEvent) => void
    onError: (event: YouTubePlayerEvent) => void
  }
}

interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: YouTubePlayerConfig) => YouTubePlayerLike
  PlayerState: {
    UNSTARTED: number
    ENDED: number
    PLAYING: number
    PAUSED: number
    BUFFERING: number
    CUED: number
  }
}

declare global {
  interface Window {
    YT?: YouTubeNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

interface PlayerSlot {
  container: HTMLElement
  iframeHost: HTMLElement
  player: YouTubePlayerLike | null
  ready: boolean
  videoId: string | null
  state: YouTubePlayerState
}

interface CrossfadeRuntime {
  from: DeckId
  to: DeckId
  startedAt: number
  duration: number
  plan: TransitionPlan
  raf: number | null
  cancelled: boolean
}

const YT_ERRORS: Record<number, string> = {
  2: 'ID video YouTube non valido.',
  5: 'Il player HTML5 non è supportato su questo browser.',
  100: 'Video non trovato o privato.',
  101: 'Il proprietario non consente la riproduzione incorporata.',
  150: 'Il proprietario non consente la riproduzione incorporata.',
}

let apiPromise: Promise<void> | null = null

function loadIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('youtube-iframe-api')
    const timeout = window.setTimeout(() => {
      apiPromise = null
      reject(new Error('YouTube IFrame API non ha risposto. Controlla la connessione.'))
    }, 15_000)
    const previousCallback = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout)
      previousCallback?.()
      if (window.YT?.Player) resolve()
      else {
        apiPromise = null
        reject(new Error('YouTube IFrame API non disponibile'))
      }
    }
    if (!existingScript) {
      const script = document.createElement('script')
      script.id = 'youtube-iframe-api'
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      script.onerror = () => {
        window.clearTimeout(timeout)
        apiPromise = null
        reject(new Error('Impossibile caricare YouTube IFrame API. Sei online?'))
      }
      document.head.appendChild(script)
    }
  })
  return apiPromise
}

export class YouTubeEngine {
  private slots: Record<DeckId, PlayerSlot | null> = { A: null, B: null }
  private listeners = new Set<(event: YouTubeEngineEvent) => void>()
  private baseVolumes: Record<DeckId, number> = { A: 0.82, B: 0.82 }
  private crossfader: {
    currentDeck: DeckId
    position: number
    curve: 'equalPower' | 'linear'
  } = { currentDeck: 'A', position: 0, curve: 'equalPower' }
  private crossfade: CrossfadeRuntime | null = null

  subscribe(listener: (event: YouTubeEngineEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: YouTubeEngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[youtube] listener error', error)
      }
    }
  }

  async mount(deck: DeckId, container: HTMLElement): Promise<void> {
    const current = this.slots[deck]
    if (current?.container === container && current.player) return
    if (current) this.destroyDeck(deck)
    await loadIframeApi()
    if (!window.YT?.Player) throw new Error('YouTube IFrame API non disponibile')
    const iframeHost = document.createElement('div')
    iframeHost.className = 'yt-iframe-host'
    container.replaceChildren(iframeHost)
    const slot: PlayerSlot = {
      container,
      iframeHost,
      player: null,
      ready: false,
      videoId: null,
      state: 'unstarted',
    }
    this.slots[deck] = slot
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('Il player YouTube non si è inizializzato in tempo.'))
      }, 12_000)
      try {
        const player = new window.YT!.Player(iframeHost, {
          videoId: '',
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (settled) return
              settled = true
              window.clearTimeout(timeout)
              slot.player = event.target
              slot.ready = true
              this.applyVolume(deck)
              this.emit({ type: 'ready', deck })
              resolve()
            },
            onStateChange: (event) => this.handleStateChange(deck, event.data ?? -1),
            onError: (event) => {
              const message = YT_ERRORS[event.data ?? 0] ?? 'Errore di riproduzione YouTube'
              this.emit({ type: 'error', deck, message })
            },
          },
        })
        slot.player = player
      } catch (error) {
        window.clearTimeout(timeout)
        settled = true
        reject(error instanceof Error ? error : new Error('Player YouTube non creato'))
      }
    })
  }

  private handleStateChange(deck: DeckId, ytState: number): void {
    const slot = this.slots[deck]
    if (!slot) return
    const stateMap: Record<number, YouTubePlayerState> = {
      [-1]: 'unstarted',
      0: 'ended',
      1: 'playing',
      2: 'paused',
      3: 'buffering',
      5: 'cued',
    }
    const state = stateMap[ytState] ?? 'unknown'
    slot.state = state
    this.emit({ type: 'state', deck, state })
  }

  isReady(deck: DeckId): boolean {
    return Boolean(this.slots[deck]?.ready)
  }

  async load(deck: DeckId, videoId: string, startSeconds = 0): Promise<void> {
    const slot = this.slots[deck]
    if (!slot?.ready || !slot.player) {
      throw new Error('Player YouTube non ancora pronto. Attendi un istante e riprova.')
    }
    if (slot.videoId === videoId) return
    slot.videoId = videoId
    slot.player.cueVideoById({ videoId, startSeconds })
    slot.state = 'cued'
    this.emit({ type: 'state', deck, state: 'cued' })
    this.applyVolume(deck)
  }

  async ensureLoaded(deck: DeckId, videoId: string): Promise<void> {
    const slot = this.slots[deck]
    if (!slot?.ready || !slot.player) {
      throw new Error('Apri la modalità YouTube per inizializzare i player.')
    }
    if (slot.videoId !== videoId) await this.load(deck, videoId)
  }

  play(deck: DeckId): void {
    const slot = this.slots[deck]
    if (!slot?.player || !slot.ready) {
      throw new Error('Player YouTube non pronto. Attendi il caricamento del video.')
    }
    this.applyVolume(deck)
    slot.player.unMute()
    slot.player.playVideo()
  }

  pause(deck: DeckId): void {
    this.slots[deck]?.player?.pauseVideo()
  }

  seek(deck: DeckId, seconds: number): void {
    const player = this.slots[deck]?.player
    if (!player) return
    try {
      player.seekTo(Math.max(0, seconds), true)
    } catch {
      this.emit({ type: 'error', deck, message: 'Impossibile spostarsi nel video.' })
    }
  }

  getPosition(deck: DeckId): number {
    const player = this.slots[deck]?.player
    if (!player) return 0
    try {
      return Math.max(0, player.getCurrentTime())
    } catch {
      return 0
    }
  }

  getDuration(deck: DeckId): number {
    const player = this.slots[deck]?.player
    if (!player) return 0
    try {
      return Math.max(0, player.getDuration())
    } catch {
      return 0
    }
  }

  getState(deck: DeckId): YouTubePlayerState {
    return this.slots[deck]?.state ?? 'unstarted'
  }

  setBaseVolume(deck: DeckId, volume: number): void {
    this.baseVolumes[deck] = clamp(volume, 0, 1)
    if (!this.crossfade) this.applyVolume(deck)
  }

  setCrossfader(
    currentDeck: DeckId,
    position: number,
    curve: 'equalPower' | 'linear',
    immediate = false,
  ): void {
    this.crossfader = { currentDeck, position: clamp(position, 0, 1), curve }
    if (this.crossfade) return
    this.applyVolume('A')
    this.applyVolume('B')
    if (immediate) {
      // The API only accepts integer volumes; the call above is already immediate.
    }
  }

  private applyVolume(deck: DeckId): void {
    const slot = this.slots[deck]
    if (!slot?.player) return
    if (this.crossfade) return
    const x = this.crossfader.position
    const physicalX = this.crossfader.currentDeck === 'A' ? x : 1 - x
    const [gainA, gainB] = crossfaderGains(physicalX, this.crossfader.curve)
    const gain = deck === 'A' ? gainA : gainB
    const value = Math.round(clamp(this.baseVolumes[deck] * gain, 0, 1) * 100)
    try {
      slot.player.setVolume(value)
    } catch {
      // Some browsers throw while the iframe is still booting.
    }
  }

  startCrossfade(
    from: DeckId,
    to: DeckId,
    plan: TransitionPlan,
    incomingOffset = 0,
  ): { startedAt: number; endsAt: number; duration: number } {
    if (this.crossfade) throw new Error('Una transizione YouTube è già in corso')
    const fromSlot = this.slots[from]
    const toSlot = this.slots[to]
    if (!fromSlot?.ready || !toSlot?.ready) {
      throw new Error('Entrambi i player YouTube devono essere pronti.')
    }
    if (!toSlot.player) throw new Error('Player YouTube di destinazione non pronto')
    try {
      toSlot.player.seekTo(incomingOffset, true)
      toSlot.player.setVolume(0)
      toSlot.player.unMute()
      toSlot.player.playVideo()
    } catch {
      throw new Error('YouTube ha bloccato la riproduzione. Tocca play nel player e riprova.')
    }
    const now = performance.now()
    const runtime: CrossfadeRuntime = {
      from,
      to,
      startedAt: now,
      duration: clamp(plan.duration, 1, 180) * 1_000,
      plan,
      raf: null,
      cancelled: false,
    }
    this.crossfade = runtime
    const tick = (): void => {
      if (runtime.cancelled) return
      const progress = clamp((performance.now() - runtime.startedAt) / runtime.duration, 0, 1)
      const index = Math.min(
        runtime.plan.volumeOut.length - 1,
        Math.round(progress * (runtime.plan.volumeOut.length - 1)),
      )
      const outCurve = runtime.plan.volumeOut[index] ?? 0
      const inCurve = runtime.plan.volumeIn[index] ?? 0
      try {
        fromSlot.player?.setVolume(Math.round(this.baseVolumes[from] * outCurve * 100))
        toSlot.player?.setVolume(Math.round(this.baseVolumes[to] * inCurve * 100))
      } catch {
        // Ignore transient iframe errors; the next frame recovers.
      }
      this.emit({ type: 'transitionProgress', from, to, progress })
      if (progress >= 1) {
        this.finishCrossfade()
        return
      }
      runtime.raf = requestAnimationFrame(tick)
    }
    runtime.raf = requestAnimationFrame(tick)
    return {
      startedAt: Date.now(),
      endsAt: Date.now() + runtime.duration,
      duration: runtime.duration / 1_000,
    }
  }

  private finishCrossfade(): void {
    const runtime = this.crossfade
    if (!runtime) return
    this.crossfade = null
    if (runtime.raf !== null) cancelAnimationFrame(runtime.raf)
    try {
      this.slots[runtime.from]?.player?.pauseVideo()
      this.slots[runtime.from]?.player?.setVolume(0)
      this.slots[runtime.to]?.player?.setVolume(Math.round(this.baseVolumes[runtime.to] * 100))
    } catch {
      // Player may have been destroyed while the fade was running.
    }
    this.emit({ type: 'transitionEnded', from: runtime.from, to: runtime.to })
  }

  cancelCrossfade(): void {
    const runtime = this.crossfade
    if (!runtime) return
    runtime.cancelled = true
    if (runtime.raf !== null) cancelAnimationFrame(runtime.raf)
    this.crossfade = null
    this.applyVolume(runtime.from)
    this.applyVolume(runtime.to)
  }

  getTransitionProgress(): number | null {
    if (!this.crossfade) return null
    return clamp((performance.now() - this.crossfade.startedAt) / this.crossfade.duration, 0, 1)
  }

  destroyDeck(deck: DeckId): void {
    if (this.crossfade && (this.crossfade.from === deck || this.crossfade.to === deck)) {
      this.cancelCrossfade()
    }
    const slot = this.slots[deck]
    if (!slot) return
    try {
      slot.player?.destroy()
    } catch {
      // Already destroyed.
    }
    slot.container.replaceChildren()
    this.slots[deck] = null
  }

  destroyAll(): void {
    if (this.crossfade) this.cancelCrossfade()
    for (const deck of ['A', 'B'] as const) this.destroyDeck(deck)
  }
}

export const youtubeEngine = new YouTubeEngine()
