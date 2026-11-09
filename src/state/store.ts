import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  AppSettings,
  DeckControls,
  DeckId,
  DeckSession,
  HistoryEntry,
  LocalTrack,
  LocalSession,
  SourceMode,
  ToastMessage,
  TransitionSettings,
  YouTubeTrack,
} from '../types'
import { uid } from '../lib/format'

export type PanelId = 'library' | 'youtube' | 'settings' | 'controls' | 'transition' | null

export interface AnalysisProgressState {
  progress: number
  stage: string
}

export interface YouTubeAccountState {
  name: string
  picture: string
}

interface MixerState {
  bootError: string | null
  mode: SourceMode
  library: LocalTrack[]
  localQueue: string[]
  youtubeQueue: YouTubeTrack[]
  localSession: LocalSession
  youtubeSession: DeckSession
  controls: Record<DeckId, DeckControls>
  transition: TransitionSettings
  settings: AppSettings
  history: HistoryEntry[]
  analysisProgress: Record<string, AnalysisProgressState>
  importing: boolean
  panel: PanelId
  toasts: ToastMessage[]
  audioState: AudioContextState | 'uninitialised'
  audioUnlocked: boolean
  isOnline: boolean
  youtubeAccount: YouTubeAccountState | null
  youtubeAuthBusy: boolean
  storageUsage: number
  storageQuota: number
  storagePersisted: boolean

  setBootError: (message: string | null) => void
  setMode: (mode: SourceMode) => void
  setLibrary: (tracks: LocalTrack[]) => void
  upsertLibraryTrack: (track: LocalTrack) => void
  removeLibraryTrack: (id: string) => void
  setLocalQueue: (ids: string[]) => void
  enqueueLocal: (id: string, position?: 'next' | 'end') => void
  setYoutubeQueue: (tracks: YouTubeTrack[]) => void
  enqueueYouTube: (track: YouTubeTrack, position?: 'next' | 'end') => void
  updateSession: (
    mode: SourceMode,
    update: Partial<DeckSession> | ((session: DeckSession) => Partial<DeckSession>),
  ) => void
  setDeckTrack: (mode: SourceMode, deck: DeckId, track: DeckSession['tracks'][DeckId]) => void
  setPlaying: (mode: SourceMode, deck: DeckId, playing: boolean) => void
  setLoading: (mode: SourceMode, deck: DeckId, loading: boolean) => void
  setLocalBufferReady: (deck: DeckId, ready: boolean) => void
  setControls: (deck: DeckId, controls: Partial<DeckControls>) => void
  setTransition: (settings: Partial<TransitionSettings>) => void
  setSettings: (settings: Partial<AppSettings>) => void
  setAnalysisProgress: (trackId: string, progress: AnalysisProgressState | null) => void
  setImporting: (importing: boolean) => void
  setPanel: (panel: PanelId) => void
  pushToast: (toast: Omit<ToastMessage, 'id'>) => string
  removeToast: (id: string) => void
  setAudioState: (state: AudioContextState | 'uninitialised') => void
  setAudioUnlocked: (unlocked: boolean) => void
  setOnline: (online: boolean) => void
  setYouTubeAccount: (account: YouTubeAccountState | null) => void
  setYouTubeAuthBusy: (busy: boolean) => void
  setHistory: (history: HistoryEntry[]) => void
  addHistory: (entry: Omit<HistoryEntry, 'id'>) => void
  setStorageInfo: (usage: number, quota: number, persisted: boolean) => void
}

const defaultControls: DeckControls = {
  volume: 0.82,
  gainDb: 0,
  lowDb: 0,
  midDb: 0,
  highDb: 0,
  filter: 0,
  cuePoint: 0,
}

function createSession(): LocalSession {
  return {
    currentDeck: 'A',
    nextDeck: 'B',
    tracks: { A: null, B: null },
    playing: { A: false, B: false },
    loading: { A: false, B: false },
    crossfader: 0,
    transitionStartedAt: null,
    transitionEndsAt: null,
    transitionFrom: null,
    transitionTo: null,
    mixStart: null,
    buffersReady: { A: false, B: false },
  }
}

const defaultTransition: TransitionSettings = {
  preset: 'auto',
  bars: 16,
  volumeCurve: 'smooth',
  eqCurve: 'center',
  filterCurve: 'none',
  autoMix: false,
  snapToBeat: true,
}

const defaultSettings: AppSettings = {
  crossfaderCurve: 'equalPower',
  masterVolume: 0.9,
  haptics: true,
  reduceMotion: false,
  persistAudioFiles: true,
  storeCapMb: 220,
}

const safeStorage = createJSONStorage(() => ({
  getItem: (name: string): string | null => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // Storage might be full or blocked. The app remains usable in memory.
    }
  },
  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name)
    } catch {
      // No-op when storage is unavailable.
    }
  },
}))

export const useMixerStore = create<MixerState>()(
  persist(
    (set, get) => ({
      bootError: null,
      mode: 'local',
      library: [],
      localQueue: [],
      youtubeQueue: [],
      localSession: createSession(),
      youtubeSession: createSession(),
      controls: { A: { ...defaultControls }, B: { ...defaultControls } },
      transition: { ...defaultTransition },
      settings: { ...defaultSettings },
      history: [],
      analysisProgress: {},
      importing: false,
      panel: null,
      toasts: [],
      audioState: 'uninitialised',
      audioUnlocked: false,
      isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
      youtubeAccount: null,
      youtubeAuthBusy: false,
      storageUsage: 0,
      storageQuota: 0,
      storagePersisted: false,

      setBootError: (message) => set({ bootError: message }),
      setMode: (mode) => set({ mode }),
      setLibrary: (tracks) => set({ library: tracks }),
      upsertLibraryTrack: (track) =>
        set((state) => {
          const index = state.library.findIndex((item) => item.id === track.id)
          if (index === -1) return { library: [track, ...state.library] }
          const next = [...state.library]
          next[index] = track
          return { library: next }
        }),
      removeLibraryTrack: (id) =>
        set((state) => ({
          library: state.library.filter((track) => track.id !== id),
          localQueue: state.localQueue.filter((queued) => queued !== id),
        })),
      setLocalQueue: (ids) => set({ localQueue: ids }),
      enqueueLocal: (id, position = 'end') =>
        set((state) => {
          const without = state.localQueue.filter((queued) => queued !== id)
          const queue = position === 'next' ? [id, ...without] : [...without, id]
          return { localQueue: queue }
        }),
      setYoutubeQueue: (tracks) => set({ youtubeQueue: tracks }),
      enqueueYouTube: (track, position = 'end') =>
        set((state) => {
          const without = state.youtubeQueue.filter((item) => item.id !== track.id)
          return position === 'next'
            ? { youtubeQueue: [track, ...without] }
            : { youtubeQueue: [...without, track] }
        }),
      updateSession: (mode, update) =>
        set((state) => {
          if (mode === 'local') {
            const partial = typeof update === 'function' ? update(state.localSession) : update
            return { localSession: { ...state.localSession, ...partial } as LocalSession }
          }
          const partial = typeof update === 'function' ? update(state.youtubeSession) : update
          return { youtubeSession: { ...state.youtubeSession, ...partial } }
        }),
      setDeckTrack: (mode, deck, track) =>
        set((state) => {
          if (mode === 'local') {
            return {
              localSession: {
                ...state.localSession,
                tracks: { ...state.localSession.tracks, [deck]: track },
              },
            }
          }
          return {
            youtubeSession: {
              ...state.youtubeSession,
              tracks: { ...state.youtubeSession.tracks, [deck]: track },
            },
          }
        }),
      setPlaying: (mode, deck, playing) =>
        set((state) => {
          if (mode === 'local') {
            return {
              localSession: {
                ...state.localSession,
                playing: { ...state.localSession.playing, [deck]: playing },
              },
            }
          }
          return {
            youtubeSession: {
              ...state.youtubeSession,
              playing: { ...state.youtubeSession.playing, [deck]: playing },
            },
          }
        }),
      setLoading: (mode, deck, loading) =>
        set((state) => {
          if (mode === 'local') {
            return {
              localSession: {
                ...state.localSession,
                loading: { ...state.localSession.loading, [deck]: loading },
              },
            }
          }
          return {
            youtubeSession: {
              ...state.youtubeSession,
              loading: { ...state.youtubeSession.loading, [deck]: loading },
            },
          }
        }),
      setLocalBufferReady: (deck, ready) =>
        set((state) => ({
          localSession: {
            ...state.localSession,
            buffersReady: { ...state.localSession.buffersReady, [deck]: ready },
          },
        })),
      setControls: (deck, controls) =>
        set((state) => ({
          controls: {
            ...state.controls,
            [deck]: { ...state.controls[deck], ...controls },
          },
        })),
      setTransition: (settings) =>
        set((state) => ({ transition: { ...state.transition, ...settings } })),
      setSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),
      setAnalysisProgress: (trackId, progress) =>
        set((state) => {
          const next = { ...state.analysisProgress }
          if (progress) next[trackId] = progress
          else delete next[trackId]
          return { analysisProgress: next }
        }),
      setImporting: (importing) => set({ importing }),
      setPanel: (panel) => set({ panel }),
      pushToast: (toast) => {
        const id = uid('toast')
        set((state) => ({
          toasts: [...state.toasts.slice(-2), { ...toast, id }],
        }))
        const duration = toast.duration ?? (toast.kind === 'error' ? 6500 : 3800)
        if (duration > 0) {
          window.setTimeout(() => get().removeToast(id), duration)
        }
        return id
      },
      removeToast: (id) =>
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
      setAudioState: (audioState) => set({ audioState }),
      setAudioUnlocked: (audioUnlocked) => set({ audioUnlocked }),
      setOnline: (isOnline) => set({ isOnline }),
      setYouTubeAccount: (youtubeAccount) => set({ youtubeAccount }),
      setYouTubeAuthBusy: (youtubeAuthBusy) => set({ youtubeAuthBusy }),
      setHistory: (history) => set({ history }),
      addHistory: (entry) =>
        set((state) => {
          const history = [{ ...entry, id: uid('history') }, ...state.history].slice(0, 30)
          try {
            localStorage.setItem('tandem.history.v1', JSON.stringify(history))
          } catch {
            // History is a convenience; playback must not fail if storage is full.
          }
          return { history }
        }),
      setStorageInfo: (storageUsage, storageQuota, storagePersisted) =>
        set({ storageUsage, storageQuota, storagePersisted }),
    }),
    {
      name: 'tandem.preferences.v1',
      storage: safeStorage,
      version: 1,
      partialize: (state) => ({
        transition: state.transition,
        settings: state.settings,
      }),
      merge: (persisted, current) => {
        const typed = persisted as
          { transition?: Partial<TransitionSettings>; settings?: Partial<AppSettings> } | undefined
        return {
          ...current,
          transition: { ...current.transition, ...typed?.transition },
          settings: { ...current.settings, ...typed?.settings },
        }
      },
    },
  ),
)

export function activeSession(state: MixerState): DeckSession {
  return state.mode === 'local' ? state.localSession : state.youtubeSession
}

export function activeCurrentDeck(state: MixerState): DeckId {
  return activeSession(state).currentDeck
}

export function activeNextDeck(state: MixerState): DeckId {
  return activeSession(state).nextDeck
}

export function activeCurrentTrack(state: MixerState) {
  const session = activeSession(state)
  return session.tracks[session.currentDeck]
}

export function activeNextTrack(state: MixerState) {
  const session = activeSession(state)
  return session.tracks[session.nextDeck]
}

export function getTransitionPlanBpm(track: ReturnType<typeof activeCurrentTrack>): number | null {
  if (!track) return null
  return track.source === 'local' ? (track.analysis?.bpm ?? null) : null
}

export function loadHistoryFromStorage(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem('tandem.history.v1')
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is HistoryEntry => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as HistoryEntry).id === 'string' &&
        typeof (entry as HistoryEntry).title === 'string'
      )
    })
  } catch {
    return []
  }
}
