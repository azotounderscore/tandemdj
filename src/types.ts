export const DECK_IDS = ['A', 'B'] as const
export type DeckId = (typeof DECK_IDS)[number]

export type SourceMode = 'local' | 'youtube'

export type TransitionPreset = 'custom' | 'auto' | 'fade' | 'rise'
export type BarCount = 1 | 2 | 4 | 8 | 16 | 32
export type VolumeCurve = 'smooth' | 'overlap' | 'linear' | 'cutIn' | 'fadeOutCut'
export type EqCurve = 'center' | 'end' | 'start' | 'threeBand' | 'quickCut' | 'none'
export type FilterCurve = 'none' | 'lowOut' | 'lowIn' | 'lowInLowOut' | 'lowInHighOut'

export interface AnalysisResult {
  bpm: number
  bpmConfidence: number
  firstBeat: number
  musicalKey: string
  camelot: string
  keyConfidence: number
  peaks: number[]
  rms: number
  analysedSeconds: number
}

export interface LocalTrack {
  id: string
  source: 'local'
  title: string
  artist: string
  fileName: string
  fileSize: number
  duration: number
  addedAt: number
  offlineBytes: number
  hasBlob: boolean
  colorIndex: number
  analysis: AnalysisResult | null
}

export interface YouTubeTrack {
  id: string
  source: 'youtube'
  videoId: string
  title: string
  artist: string
  duration: number
  thumbnail: string
  addedAt: number
}

export type Track = LocalTrack | YouTubeTrack

export interface YouTubeSearchItem {
  videoId: string
  title: string
  artist: string
  duration: number
  thumbnail: string
}

export interface YouTubePlaylist {
  id: string
  title: string
  description: string
  thumbnail: string
  itemCount: number
}

export interface DeckControls {
  volume: number
  gainDb: number
  lowDb: number
  midDb: number
  highDb: number
  filter: number
  cuePoint: number
}

export interface TransitionSettings {
  preset: TransitionPreset
  bars: BarCount
  volumeCurve: VolumeCurve
  eqCurve: EqCurve
  filterCurve: FilterCurve
  autoMix: boolean
  snapToBeat: boolean
}

export interface AppSettings {
  crossfaderCurve: 'equalPower' | 'linear'
  masterVolume: number
  haptics: boolean
  reduceMotion: boolean
  persistAudioFiles: boolean
  storeCapMb: number
}

export interface DeckSession {
  currentDeck: DeckId
  nextDeck: DeckId
  tracks: Record<DeckId, Track | null>
  playing: Record<DeckId, boolean>
  loading: Record<DeckId, boolean>
  crossfader: number
  transitionStartedAt: number | null
  transitionEndsAt: number | null
  transitionFrom: DeckId | null
  transitionTo: DeckId | null
  mixStart: number | null
}

export interface LocalSession extends DeckSession {
  buffersReady: Record<DeckId, boolean>
}

export interface HistoryEntry {
  id: string
  trackId: string
  title: string
  artist: string
  source: SourceMode
  mixedAt: number
  bpm: number | null
  camelot: string | null
}

export interface TransitionPlan {
  duration: number
  volumeOut: number[]
  volumeIn: number[]
  eqLowOut: number[]
  eqLowIn: number[]
  lowpassOut: number[]
  lowpassIn: number[]
  highpassOut: number[]
  highpassIn: number[]
  usedFallbackBpm: boolean
}

export interface ToastMessage {
  id: string
  kind: 'info' | 'success' | 'warning' | 'error'
  message: string
  actionLabel?: string
  action?: () => void
  duration?: number
}

export interface YouTubePlayerLike {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (volume: number) => void
  mute: () => void
  unMute: () => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void
  cueVideoById: (options: { videoId: string; startSeconds?: number }) => void
  destroy: () => void
}
