import { audioEngine } from '../audio/engine'
import { youtubeEngine } from '../audio/youtube-engine'
import {
  clearAllTracks,
  deleteLocalTrack,
  getStorageEstimate,
  getTrackBlob,
  listLocalTracks,
  requestPersistentStorage,
  saveLocalTrack,
  saveTrackBlob,
} from '../lib/db'
import { clamp, formatTransitionLength, parseFileName } from '../lib/format'
import { fileId, isLikelyAudioFile, MAX_FILE_BYTES, pickLocalAudioFiles } from '../lib/files'
import { loadPersistedLocalSession, saveLocalSession } from '../lib/session-storage'
import { buildTransitionPlan, transitionDuration } from '../lib/transitions'
import type {
  DeckControls,
  DeckId,
  HistoryEntry,
  LocalTrack,
  SourceMode,
  TransitionSettings,
  YouTubeSearchItem,
  YouTubeTrack,
} from '../types'
import { analysisClient, extractMonoSamples } from '../workers/analysis-client'
import { activeSession, loadHistoryFromStorage, useMixerStore } from './store'

let initPromise: Promise<void> | null = null
let importInFlight = false
let engineUnsubscribe: (() => void) | null = null
let youtubeUnsubscribe: (() => void) | null = null
let sessionPersistenceStarted = false
let pointerUnlockAttached = false
const deckLoadVersion: Record<DeckId, number> = { A: 0, B: 0 }
let autoMixAttemptedFor: string | null = null
let transitionCompletionInFlight = false

function state() {
  return useMixerStore.getState()
}

function toast(
  kind: 'info' | 'success' | 'warning' | 'error',
  message: string,
  duration?: number,
): void {
  state().pushToast({ kind, message, duration })
}

function currentTrack() {
  const snapshot = state()
  const session = activeSession(snapshot)
  return session.tracks[session.currentDeck]
}

function currentBpm(): number | null {
  const track = currentTrack()
  return track?.source === 'local' ? (track.analysis?.bpm ?? null) : null
}

function nextBpm(): number | null {
  const snapshot = state()
  const session = activeSession(snapshot)
  const track = session.tracks[session.nextDeck]
  return track?.source === 'local' ? (track.analysis?.bpm ?? null) : null
}

function resetAutoMixAttempt(): void {
  autoMixAttemptedFor = null
}

function isLocalTrackOnAnyDeck(id: string): boolean {
  const local = state().localSession
  return local.tracks.A?.id === id || local.tracks.B?.id === id
}

function persistCurrentSession(): void {
  const local = state().localSession
  saveLocalSession({
    currentDeck: local.currentDeck,
    nextDeck: local.nextDeck,
    trackIds: {
      A: local.tracks.A?.id ?? null,
      B: local.tracks.B?.id ?? null,
    },
    queue: state().localQueue,
  })
}

function updateMediaMetadata(): void {
  if (!('mediaSession' in navigator)) return
  const track = currentTrack()
  if (!track) {
    navigator.mediaSession.metadata = null
    return
  }
  const artwork: MediaMetadataInit['artwork'] =
    track.source === 'youtube' && track.thumbnail
      ? [
          { src: track.thumbnail, sizes: '320x180', type: 'image/jpeg' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ]
      : [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: 'Tandem DJ',
    artwork,
  })
  const session = activeSession(state())
  navigator.mediaSession.playbackState = session.playing[session.currentDeck] ? 'playing' : 'paused'
}

function configureMediaSession(): void {
  if (!('mediaSession' in navigator)) return
  try {
    navigator.mediaSession.setActionHandler('play', () => {
      void toggleCurrentPlay()
    })
    navigator.mediaSession.setActionHandler('pause', () => {
      void toggleCurrentPlay()
    })
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      void startMix()
    })
  } catch {
    // Some browsers expose only a subset of action handlers.
  }
}

async function refreshStorageInfo(): Promise<void> {
  const estimate = await getStorageEstimate()
  state().setStorageInfo(estimate.usage, estimate.quota, estimate.persisted)
}

function recordHistory(track: LocalTrack | YouTubeTrack): void {
  const snapshot = state()
  const latest = snapshot.history[0]
  if (latest && latest.trackId === track.id && Date.now() - latest.mixedAt < 10 * 60 * 1_000) {
    return
  }
  const entry: Omit<HistoryEntry, 'id'> = {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    source: track.source,
    mixedAt: Date.now(),
    bpm: track.source === 'local' ? (track.analysis?.bpm ?? null) : null,
    camelot: track.source === 'local' ? (track.analysis?.camelot ?? null) : null,
  }
  snapshot.addHistory(entry)
}

async function ensureAudioGesture(): Promise<void> {
  try {
    const contextState = await audioEngine.unlock()
    state().setAudioUnlocked(true)
    state().setAudioState(contextState)
  } catch (error) {
    state().setAudioUnlocked(false)
    toast('error', error instanceof Error ? error.message : 'Audio non disponibile')
  }
}

async function hydrateLocalDeck(
  track: LocalTrack,
  deck: DeckId,
  options: { showLoading?: boolean; moveToNew?: boolean } = {},
): Promise<boolean> {
  const version = ++deckLoadVersion[deck]
  if (options.showLoading !== false) state().setLoading('local', deck, true)
  state().setLocalBufferReady(deck, false)
  let blob: Blob | null = null
  try {
    blob = await getTrackBlob(track.id)
    if (!blob) {
      toast('warning', 'File non disponibile offline: reimportalo dalla libreria per riprodurlo.')
      return false
    }
    if (version !== deckLoadVersion[deck]) return false
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = await audioEngine.decode(arrayBuffer)
    if (version !== deckLoadVersion[deck]) return false
    const localState = state().localSession
    // The target may have changed while decoding. Never overwrite a newer load.
    if (localState.tracks[deck] && localState.tracks[deck]?.id !== track.id) {
      return false
    }
    audioEngine.loadBuffer(deck, buffer)
    audioEngine.setControls(deck, state().controls[deck])
    audioEngine.setCrossfader(
      localState.currentDeck,
      localState.crossfader,
      state().settings.crossfaderCurve,
      true,
    )
    state().setLocalBufferReady(deck, true)
    if (options.moveToNew !== false) {
      state().setDeckTrack('local', deck, track)
    }
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'File audio non leggibile'
    toast('error', `Impossibile caricare “${track.title}”: ${message}`)
    return false
  } finally {
    if (version === deckLoadVersion[deck]) {
      state().setLoading('local', deck, false)
    }
  }
}

async function loadLocalTrackToDeck(
  track: LocalTrack,
  deck: DeckId,
  options: { autoplay?: boolean } = {},
): Promise<boolean> {
  const snapshot = state()
  if (options.autoplay) await ensureAudioGesture()
  const session = snapshot.localSession
  if (snapshot.mode !== 'local') {
    await switchSourceMode('local')
  }
  if (session.transitionFrom) {
    toast('warning', 'Attendi la fine della transizione prima di cambiare brano.')
    return false
  }
  if (session.playing[deck]) audioEngine.pause(deck)
  state().setPlaying('local', deck, false)
  state().setDeckTrack('local', deck, track)
  state().updateSession('local', { mixStart: null })
  state().setControls(deck, { cuePoint: 0 })
  const ok = await hydrateLocalDeck(track, deck)
  if (ok) {
    state().setLocalBufferReady(deck, true)
    if (options.autoplay) {
      await playDeck(deck)
    }
    persistCurrentSession()
  }
  return ok
}

function maybeAssignImportedTrack(
  track: LocalTrack,
  file: File,
  buffer: AudioBuffer,
): DeckId | null {
  const snapshot = state()
  const local = snapshot.localSession
  if (local.transitionFrom) return null
  let target: DeckId | null = null
  if (!local.tracks[local.currentDeck]) target = local.currentDeck
  else if (!local.tracks[local.nextDeck]) target = local.nextDeck
  if (!target) return null
  const version = ++deckLoadVersion[target]
  audioEngine.loadBuffer(target, buffer)
  audioEngine.setControls(target, snapshot.controls[target])
  audioEngine.setCrossfader(
    local.currentDeck,
    local.crossfader,
    snapshot.settings.crossfaderCurve,
    true,
  )
  state().setControls(target, { cuePoint: 0 })
  state().setDeckTrack('local', target, track)
  state().setLocalBufferReady(target, true)
  state().setLoading('local', target, false)
  if (version !== deckLoadVersion[target]) return null
  void file
  return target
}

function queueImportedTrack(trackId: string): void {
  const snapshot = state()
  if (snapshot.localQueue.includes(trackId)) return
  state().setLocalQueue([...snapshot.localQueue, trackId])
}

function canPersistFile(file: File, trackId: string): boolean {
  const snapshot = state()
  if (!snapshot.settings.persistAudioFiles) return false
  const existing = snapshot.library.find((item) => item.id === trackId)
  const currentBytes = snapshot.library.reduce((sum, item) => sum + item.offlineBytes, 0)
  const bytesWithoutExisting = Math.max(0, currentBytes - (existing?.offlineBytes ?? 0))
  const cap = snapshot.settings.storeCapMb * 1024 * 1024
  return bytesWithoutExisting + file.size <= cap
}

async function storeTrackBlob(track: LocalTrack, file: File): Promise<LocalTrack> {
  const existing = state().library.find((item) => item.id === track.id)
  const canStore = canPersistFile(file, track.id)
  if (!canStore) {
    return {
      ...track,
      hasBlob: false,
      offlineBytes: 0,
      addedAt: existing?.addedAt ?? track.addedAt,
    }
  }
  try {
    await saveTrackBlob(track.id, file)
    return {
      ...track,
      hasBlob: true,
      offlineBytes: file.size,
      addedAt: existing?.addedAt ?? track.addedAt,
    }
  } catch {
    toast(
      'warning',
      'Spazio browser insufficiente: il brano resta in memoria ma non sarà disponibile dopo la chiusura.',
    )
    return {
      ...track,
      hasBlob: false,
      offlineBytes: 0,
      addedAt: existing?.addedAt ?? track.addedAt,
    }
  }
}

export async function importLocalFiles(files: File[]): Promise<void> {
  if (files.length === 0) return
  if (importInFlight) {
    toast('info', 'Attendi la fine dell’importazione in corso.')
    return
  }
  importInFlight = true
  state().setImporting(true)
  state().setPanel(null)
  await switchSourceMode('local')
  await ensureAudioGesture()

  let imported = 0
  let failed = 0
  let queued = 0
  const errors: string[] = []
  const candidates = files.filter(isLikelyAudioFile)

  if (candidates.length !== files.length) {
    toast('warning', 'Alcuni file non sembrano audio e sono stati ignorati.')
  }
  if (candidates.length === 0) {
    importInFlight = false
    state().setImporting(false)
    toast('error', 'Nessun file audio valido selezionato.')
    return
  }

  const initialCount = candidates.filter((file) => file.size <= MAX_FILE_BYTES).length
  if (initialCount > 0) {
    toast(
      'info',
      initialCount === 1
        ? 'Importazione e analisi del brano…'
        : `Importazione di ${initialCount} brani…`,
    )
  }
  void requestPersistentStorage().then((persisted) => {
    if (persisted) void refreshStorageInfo()
  })

  for (const file of candidates) {
    if (file.size === 0) {
      failed += 1
      errors.push(`${file.name}: file vuoto`)
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      failed += 1
      errors.push(`${file.name}: oltre 160 MB`)
      continue
    }
    const parsed = parseFileName(file.name)
    const id = fileId(file)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = await audioEngine.decode(arrayBuffer)
      const trackId = id
      let track: LocalTrack = {
        id: trackId,
        source: 'local',
        title: parsed.title,
        artist: parsed.artist,
        fileName: file.name,
        fileSize: file.size,
        duration: buffer.duration,
        addedAt: Date.now(),
        offlineBytes: 0,
        hasBlob: false,
        colorIndex: [...trackId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6,
        analysis: null,
      }
      track = await storeTrackBlob(track, file)
      const target = maybeAssignImportedTrack(track, file, buffer)
      if (!target) {
        queueImportedTrack(track.id)
        queued += 1
      }
      state().upsertLibraryTrack(track)
      imported += 1
      await saveLocalTrack(track).catch(() => {
        toast('warning', 'Metadati non salvati su disco: la sessione resta attiva.')
      })

      if (target) {
        state().setAnalysisProgress(track.id, { progress: 0, stage: 'Analisi in coda' })
      }
      try {
        const mono = extractMonoSamples(buffer)
        const analysis = await analysisClient.analyse(mono, buffer.duration, (progress) => {
          state().setAnalysisProgress(track.id, progress)
        })
        const analysedTrack: LocalTrack = { ...track, analysis }
        state().upsertLibraryTrack(analysedTrack)
        const currentLocal = state().localSession
        if (currentLocal.tracks.A?.id === track.id) {
          state().setDeckTrack('local', 'A', analysedTrack)
        }
        if (currentLocal.tracks.B?.id === track.id) {
          state().setDeckTrack('local', 'B', analysedTrack)
        }
        await saveLocalTrack(analysedTrack).catch(() => {})
        if (analysis.bpm <= 0) {
          toast('warning', `BPM non rilevato per “${track.title}”. La transizione userà 120 BPM.`)
        }
      } catch {
        toast('warning', `Analisi non riuscita per “${track.title}”: il brano resta riproducibile.`)
      } finally {
        state().setAnalysisProgress(track.id, null)
      }
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : 'File non valido'
      errors.push(`${file.name}: ${message}`)
    }
  }

  importInFlight = false
  state().setImporting(false)
  await refreshStorageInfo()
  persistCurrentSession()
  if (errors.length > 0) {
    toast('error', errors.slice(0, 3).join(' · '), 7000)
  }
  if (imported > 0) {
    const details = [
      `${imported} ${imported === 1 ? 'brano importato' : 'brani importati'}`,
      queued > 0 ? `${queued} in coda` : '',
      failed > 0 ? `${failed} non validi` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    toast('success', details)
  } else if (failed > 0) {
    toast('error', 'Nessun brano importato. Controlla formato, dimensioni e permessi dei file.')
  }
}

export async function removeLocalTrack(id: string): Promise<void> {
  const snapshot = state()
  if (snapshot.localSession.transitionFrom && isLocalTrackOnAnyDeck(id)) {
    toast('warning', 'Non puoi rimuovere un brano durante una transizione.')
    return
  }
  if (isLocalTrackOnAnyDeck(id)) {
    toast('warning', 'Scarica prima il brano da entrambi i deck, poi rimuovilo dalla libreria.')
    return
  }
  try {
    await deleteLocalTrack(id)
    state().removeLibraryTrack(id)
    await refreshStorageInfo()
    toast('success', 'Brano rimosso dalla libreria e dalla cache.')
  } catch {
    toast('error', 'Impossibile rimuovere il brano dalla cache locale.')
  }
}

export async function clearLocalLibrary(): Promise<void> {
  const snapshot = state()
  if (snapshot.localSession.transitionFrom) {
    toast('warning', 'Attendi la fine della transizione prima di svuotare la libreria.')
    return
  }
  audioEngine.releaseAll()
  try {
    await clearAllTracks()
    state().setLibrary([])
    state().setLocalQueue([])
    state().updateSession('local', {
      tracks: { A: null, B: null },
      playing: { A: false, B: false },
      loading: { A: false, B: false },
      crossfader: 0,
      transitionFrom: null,
      transitionTo: null,
      transitionStartedAt: null,
      transitionEndsAt: null,
      mixStart: null,
    })
    state().setLocalBufferReady('A', false)
    state().setLocalBufferReady('B', false)
    persistCurrentSession()
    await refreshStorageInfo()
    toast('success', 'Libreria locale svuotata.')
  } catch {
    toast('error', 'Impossibile svuotare la libreria locale.')
  }
}

export async function chooseFilesWithSystemPicker(): Promise<void> {
  try {
    const files = await pickLocalAudioFiles()
    if (files.length > 0) await importLocalFiles(files)
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'Selettore file non disponibile')
  }
}

export async function loadLocalTrackNext(id: string): Promise<void> {
  const track = state().library.find((item) => item.id === id)
  if (!track) return
  const local = state().localSession
  if (local.transitionFrom) {
    toast('warning', 'Transizione in corso: accoda il brano e attendi.')
    return
  }
  // Fill the active deck first when the mixer is still empty, otherwise
  // prepare the incoming deck.
  const target = local.tracks[local.currentDeck] ? local.nextDeck : local.currentDeck
  const ok = await loadLocalTrackToDeck(track, target)
  if (ok) {
    state().setPanel(null)
    toast('success', `“${track.title}” caricato nel deck ${target}.`)
  }
}

export function loadYouTubeTrackNext(track: YouTubeTrack): void {
  if (state().mode !== 'youtube') switchSourceMode('youtube')
  const session = state().youtubeSession
  if (session.transitionFrom) {
    toast('warning', 'Transizione in corso: attendi il completamento.')
    return
  }
  const target = session.tracks[session.currentDeck] ? session.nextDeck : session.currentDeck
  state().setDeckTrack('youtube', target, track)
  state().updateSession('youtube', { mixStart: null })
  state().setYoutubeQueue(state().youtubeQueue.filter((item) => item.id !== track.id))
  toast('success', `“${track.title}” pronto nel deck ${target}.`)
}

export function enqueueLocalTrack(id: string, position: 'next' | 'end' = 'end'): void {
  const track = state().library.find((item) => item.id === id)
  if (!track) return
  const snapshot = state()
  const without = snapshot.localQueue.filter((queued) => queued !== id)
  const queue = position === 'next' ? [id, ...without] : [...without, id]
  state().setLocalQueue(queue)
  toast('success', `“${track.title}” aggiunto alla coda.`)
}

export function dequeueLocalTrack(id: string): void {
  state().setLocalQueue(state().localQueue.filter((queued) => queued !== id))
}

export async function playDeck(deck: DeckId): Promise<void> {
  const snapshot = state()
  const session = activeSession(snapshot)
  const track = session.tracks[deck]
  if (!track) return
  if (snapshot.mode === 'youtube') {
    const ytSession = snapshot.youtubeSession
    const video = ytSession.tracks[deck]
    if (video?.source !== 'youtube') return
    if (ytSession.transitionFrom) {
      toast('info', 'Transizione in corso.')
      return
    }
    try {
      await youtubeEngine.ensureLoaded(deck, video.videoId)
      youtubeEngine.setBaseVolume(
        deck,
        snapshot.controls[deck].volume * snapshot.settings.masterVolume,
      )
      youtubeEngine.setCrossfader(
        ytSession.currentDeck,
        ytSession.crossfader,
        snapshot.settings.crossfaderCurve,
      )
      youtubeEngine.play(deck)
      state().setPlaying('youtube', deck, true)
      state().setAudioUnlocked(true)
      recordHistory(video)
      updateMediaMetadata()
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Riproduzione YouTube non riuscita.')
    }
    return
  }

  if (track.source !== 'local') return
  await ensureAudioGesture()
  if (!audioEngine.isLoaded(deck)) {
    const hydrated = await hydrateLocalDeck(track, deck)
    if (!hydrated) return
  }
  try {
    const started = await audioEngine.play(deck)
    if (!started) {
      toast('warning', 'Audio sospeso dal browser: tocca di nuovo play per riprendere.')
      return
    }
    state().setPlaying('local', deck, true)
    state().setAudioState(audioEngine.getContextState())
    recordHistory(track)
    updateMediaMetadata()
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'Riproduzione non riuscita')
  }
}

export function pauseDeck(deck: DeckId): void {
  const snapshot = state()
  if (snapshot.mode === 'youtube') {
    youtubeEngine.pause(deck)
    state().setPlaying('youtube', deck, false)
    return
  }
  if (!audioEngine.isLoaded(deck)) {
    state().setPlaying('local', deck, false)
    return
  }
  const position = audioEngine.pause(deck)
  const local = state().localSession
  if (local.currentDeck === deck && position > 0) {
    // Keep the cue point untouched; position is retained by the engine.
  }
  state().setPlaying('local', deck, false)
  updateMediaMetadata()
}

export async function toggleDeckPlay(deck: DeckId): Promise<void> {
  const snapshot = state()
  const session = activeSession(snapshot)
  if (session.transitionFrom) {
    toast('info', 'Una transizione è in corso: attendi il completamento.')
    return
  }
  if (session.playing[deck]) {
    pauseDeck(deck)
  } else {
    await playDeck(deck)
  }
}

export async function toggleCurrentPlay(): Promise<void> {
  const session = activeSession(state())
  await toggleDeckPlay(session.currentDeck)
}

export function seekDeck(deck: DeckId, seconds: number): void {
  const snapshot = state()
  if (snapshot.mode === 'youtube') {
    youtubeEngine.seek(deck, seconds)
    return
  }
  audioEngine.seek(deck, seconds)
}

export function seekCurrentFraction(fraction: number): void {
  const session = activeSession(state())
  const track = session.tracks[session.currentDeck]
  if (!track) return
  const duration =
    state().mode === 'local' ? audioEngine.getDuration(session.currentDeck) : track.duration
  if (!duration) return
  seekDeck(session.currentDeck, clamp(fraction, 0, 1) * duration)
}

export function cueDeck(deck: DeckId): void {
  const snapshot = state()
  if (snapshot.mode === 'youtube') {
    if (snapshot.youtubeSession.playing[deck]) {
      youtubeEngine.pause(deck)
      youtubeEngine.seek(deck, 0)
      state().setPlaying('youtube', deck, false)
    } else {
      youtubeEngine.seek(deck, 0)
    }
    return
  }
  const controls = snapshot.controls[deck]
  if (audioEngine.isPlaying(deck)) {
    audioEngine.pause(deck)
    audioEngine.seek(deck, controls.cuePoint)
    state().setPlaying('local', deck, false)
  } else {
    audioEngine.seek(deck, controls.cuePoint)
    void audioEngine.play(deck, controls.cuePoint).then((started) => {
      if (started) state().setPlaying('local', deck, true)
    })
  }
}

export function setCuePoint(deck: DeckId): void {
  const snapshot = state()
  if (snapshot.mode !== 'local') return
  const position = audioEngine.getPosition(deck)
  state().setControls(deck, { cuePoint: position })
  toast('success', `Cue del deck ${deck} impostato a ${formatClock(position)}.`)
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function setDeckControls(deck: DeckId, patch: Partial<DeckControls>): void {
  state().setControls(deck, patch)
  const snapshot = state()
  const controls = { ...snapshot.controls[deck], ...patch }
  if (snapshot.mode === 'local') {
    audioEngine.setControls(deck, controls)
  } else {
    youtubeEngine.setBaseVolume(deck, clamp(controls.volume * snapshot.settings.masterVolume, 0, 1))
  }
}

export function setMasterVolume(value: number): void {
  const volume = clamp(value, 0, 1)
  state().setSettings({ masterVolume: volume })
  audioEngine.setMasterVolume(volume)
  const snapshot = state()
  youtubeEngine.setBaseVolume('A', clamp(snapshot.controls.A.volume * volume, 0, 1))
  youtubeEngine.setBaseVolume('B', clamp(snapshot.controls.B.volume * volume, 0, 1))
}

export function setCrossfader(position: number): void {
  const snapshot = state()
  const session = activeSession(snapshot)
  if (session.transitionFrom) return
  const value = clamp(position, 0, 1)
  state().updateSession(snapshot.mode, { crossfader: value })
  if (snapshot.mode === 'local') {
    audioEngine.setCrossfader(session.currentDeck, value, snapshot.settings.crossfaderCurve)
  } else {
    youtubeEngine.setCrossfader(session.currentDeck, value, snapshot.settings.crossfaderCurve)
  }
}

export function applyTransitionSettings(patch: Partial<TransitionSettings>): void {
  state().setTransition(patch)
  if (patch.autoMix !== undefined && !patch.autoMix) resetAutoMixAttempt()
}

export function toggleAutoMix(): void {
  const enabled = !state().transition.autoMix
  state().setTransition({ autoMix: enabled })
  resetAutoMixAttempt()
  toast(
    'info',
    enabled
      ? 'Auto mix attivo: avvio automatico alla fine del mix point.'
      : 'Auto mix disattivato.',
  )
}

export function setPlannedMixStart(seconds: number | null): void {
  const snapshot = state()
  const session = activeSession(snapshot)
  const duration =
    snapshot.mode === 'local'
      ? audioEngine.getDuration(session.currentDeck)
      : (session.tracks[session.currentDeck]?.duration ?? 0)
  let value = seconds === null ? null : clamp(seconds, 0, Math.max(0, duration - 1))
  if (value !== null) {
    const plan = buildTransitionPlan(
      snapshot.transition,
      snapshot.mode === 'local' ? currentBpm() : null,
    )
    value = clamp(value, 0, Math.max(0, duration - plan.duration))
  }
  state().updateSession(snapshot.mode, { mixStart: value })
}

export function switchSourceMode(mode: SourceMode, options: { openPanel?: boolean } = {}): void {
  const snapshot = state()
  if (snapshot.mode === mode) {
    if (options.openPanel && mode === 'youtube') state().setPanel('youtube')
    return
  }
  const session = activeSession(snapshot)
  if (session.transitionFrom) {
    toast('warning', 'Attendi la fine della transizione prima di cambiare modalità.')
    return
  }
  if (snapshot.mode === 'local') {
    for (const deck of ['A', 'B'] as const) {
      if (audioEngine.isPlaying(deck)) {
        audioEngine.pause(deck)
        state().setPlaying('local', deck, false)
      }
    }
  } else {
    youtubeEngine.pause('A')
    youtubeEngine.pause('B')
    state().setPlaying('youtube', 'A', false)
    state().setPlaying('youtube', 'B', false)
  }
  state().setMode(mode)
  if (mode === 'youtube') {
    const youtube = state().youtubeSession
    const hasVideo = Boolean(youtube.tracks.A ?? youtube.tracks.B)
    if (!hasVideo) state().setPanel('youtube')
  }
  updateMediaMetadata()
  const nextSession = mode === 'local' ? state().localSession : state().youtubeSession
  if (mode === 'local') {
    audioEngine.setCrossfader(
      nextSession.currentDeck,
      nextSession.crossfader,
      state().settings.crossfaderCurve,
      true,
    )
  } else {
    youtubeEngine.setCrossfader(
      nextSession.currentDeck,
      nextSession.crossfader,
      state().settings.crossfaderCurve,
      true,
    )
  }
}

function convertYouTubeItem(item: YouTubeSearchItem): YouTubeTrack {
  return {
    id: `youtube_${item.videoId}`,
    source: 'youtube',
    videoId: item.videoId,
    title: item.title || 'Video YouTube',
    artist: item.artist || 'YouTube',
    duration: item.duration,
    thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
    addedAt: Date.now(),
  }
}

export function selectYouTubeTrack(
  item: YouTubeSearchItem,
  placement: 'auto' | 'queue' = 'auto',
): void {
  const snapshot = state()
  const track = convertYouTubeItem(item)
  if (snapshot.mode !== 'youtube') {
    switchSourceMode('youtube')
  }
  const currentState = state()
  const session = currentState.youtubeSession
  if (session.transitionFrom) {
    currentState.enqueueYouTube(track)
    toast('success', 'Video accodato: verrà caricato dopo la transizione.')
    return
  }
  if (placement === 'queue') {
    currentState.enqueueYouTube(track)
    toast('success', `“${track.title}” aggiunto alla coda YouTube.`)
    return
  }
  if (!session.tracks[session.currentDeck]) {
    state().setDeckTrack('youtube', session.currentDeck, track)
    state().updateSession('youtube', { mixStart: null })
    toast('info', `“${track.title}” pronto nel deck ${session.currentDeck}. Premi play.`)
    return
  }
  if (!session.tracks[session.nextDeck]) {
    state().setDeckTrack('youtube', session.nextDeck, track)
    state().updateSession('youtube', { mixStart: null })
    toast('info', `“${track.title}” pronto nel deck ${session.nextDeck}.`)
    return
  }
  state().enqueueYouTube(track)
  toast('success', `“${track.title}” aggiunto alla coda YouTube.`)
}

export function removeYouTubeQueueItem(id: string): void {
  state().setYoutubeQueue(state().youtubeQueue.filter((entry) => entry.id !== id))
}

export function setYouTubeAccount(account: { name: string; picture: string } | null): void {
  state().setYouTubeAccount(account)
}

async function promoteLocalDeck(from: DeckId, to: DeckId): Promise<void> {
  const snapshot = state()
  const session = snapshot.localSession
  if (session.transitionFrom !== from || session.transitionTo !== to) return
  const incoming = session.tracks[to]
  state().updateSession('local', {
    currentDeck: to,
    nextDeck: from,
    crossfader: 0,
    transitionFrom: null,
    transitionTo: null,
    transitionStartedAt: null,
    transitionEndsAt: null,
    mixStart: null,
    playing: { ...session.playing, [from]: false, [to]: true },
  })
  state().setPlaying('local', from, false)
  state().setPlaying('local', to, true)
  audioEngine.stop(from)
  audioEngine.releaseDeck(from)
  state().setLocalBufferReady(from, false)
  state().setDeckTrack('local', from, null)
  audioEngine.setCrossfader(to, 0, snapshot.settings.crossfaderCurve, true)
  if (incoming && incoming.source === 'local') recordHistory(incoming)
  resetAutoMixAttempt()
  updateMediaMetadata()
  persistCurrentSession()
  await loadNextQueuedLocalIntoDeck(from, to)
}

async function loadNextQueuedLocalIntoDeck(target: DeckId, currentDeck: DeckId): Promise<void> {
  let attempts = 0
  while (attempts < 12) {
    const snapshot = state()
    const local = snapshot.localSession
    if (local.transitionFrom) return
    const queue = [...snapshot.localQueue]
    const id = queue.shift()
    if (!id) {
      state().setLocalQueue([])
      state().setDeckTrack('local', target, null)
      state().setLocalBufferReady(target, false)
      return
    }
    state().setLocalQueue(queue)
    const track = snapshot.library.find((item) => item.id === id)
    if (!track) {
      attempts += 1
      continue
    }
    if (state().localSession.tracks[currentDeck]?.id === track.id) {
      attempts += 1
      continue
    }
    state().setDeckTrack('local', target, track)
    state().setLoading('local', target, true)
    const loaded = await hydrateLocalDeck(track, target)
    if (loaded) {
      audioEngine.setCrossfader(currentDeck, 0, state().settings.crossfaderCurve, true)
      persistCurrentSession()
      return
    }
    state().setDeckTrack('local', target, null)
    attempts += 1
  }
  state().setDeckTrack('local', 'A' === target ? 'A' : 'B', null)
}

async function promoteYouTubeDeck(from: DeckId, to: DeckId): Promise<void> {
  const snapshot = state()
  const session = snapshot.youtubeSession
  if (session.transitionFrom !== from || session.transitionTo !== to) return
  const incoming = session.tracks[to]
  const queue = [...snapshot.youtubeQueue]
  const queuedNext = queue.shift()
  state().setYoutubeQueue(queue)
  state().updateSession('youtube', {
    currentDeck: to,
    nextDeck: from,
    crossfader: 0,
    transitionFrom: null,
    transitionTo: null,
    transitionStartedAt: null,
    transitionEndsAt: null,
    mixStart: null,
    playing: { ...session.playing, [from]: false, [to]: true },
    tracks: { ...session.tracks, [from]: queuedNext ?? null },
  })
  state().setPlaying('youtube', from, false)
  state().setPlaying('youtube', to, true)
  youtubeEngine.pause(from)
  youtubeEngine.setCrossfader(to, 0, snapshot.settings.crossfaderCurve, true)
  if (incoming?.source === 'youtube') recordHistory(incoming)
  resetAutoMixAttempt()
  updateMediaMetadata()
}

async function startLocalMix(): Promise<void> {
  const snapshot = state()
  const session = snapshot.localSession
  if (session.transitionFrom) return
  const from = session.currentDeck
  const to = session.nextDeck
  const current = session.tracks[from]
  const next = session.tracks[to]
  if (!current || current.source !== 'local' || !next || next.source !== 'local') {
    toast('warning', 'Carica due brani locali sui deck per mixare.')
    return
  }
  if (!session.playing[from]) {
    toast('warning', 'Avvia il deck corrente prima di mixare.')
    return
  }
  if (!snapshot.localSession.buffersReady[to] || snapshot.localSession.loading[to]) {
    toast('warning', 'Il prossimo brano è ancora in caricamento.')
    return
  }
  if (!audioEngine.isLoaded(from) || !audioEngine.isLoaded(to)) {
    toast('warning', 'Attendi il caricamento dei buffer audio.')
    return
  }

  const bpm = current.analysis?.bpm ?? null
  const plan = buildTransitionPlan(snapshot.transition, bpm)
  const currentDuration = audioEngine.getDuration(from)
  const remaining = Math.max(0, currentDuration - audioEngine.getPosition(from))
  const nextDuration = audioEngine.getDuration(to)
  let incomingOffset = 0
  if (snapshot.transition.snapToBeat && next.analysis) {
    incomingOffset = clamp(next.analysis.firstBeat, 0, Math.max(0, nextDuration - 2))
  }
  const maxDuration = Math.max(1, Math.min(remaining, nextDuration - incomingOffset))
  const duration = Math.min(plan.duration, maxDuration)
  if (duration < plan.duration * 0.85) {
    toast('warning', 'Transizione accorciata per non superare la durata dei brani.')
  }
  plan.duration = duration

  state().updateSession('local', { crossfader: 0 })
  audioEngine.setCrossfader(from, 0, snapshot.settings.crossfaderCurve)
  try {
    const result = await audioEngine.startTransition(from, to, plan, { incomingOffset })
    if (!result) throw new Error('Transizione non avviata')
    const now = Date.now()
    state().updateSession('local', {
      transitionFrom: from,
      transitionTo: to,
      transitionStartedAt: now,
      transitionEndsAt: now + result.duration * 1_000,
      playing: { ...state().localSession.playing, [to]: true },
      mixStart: null,
    })
    state().setPlaying('local', to, true)
    if (plan.usedFallbackBpm) {
      toast('info', 'BPM non disponibile: durata calcolata a 120 BPM.')
    }
  } catch (error) {
    state().updateSession('local', {
      transitionFrom: null,
      transitionTo: null,
      transitionStartedAt: null,
      transitionEndsAt: null,
    })
    state().setPlaying('local', to, false)
    audioEngine.stop(to)
    toast('error', error instanceof Error ? error.message : 'Avvio transizione non riuscito.')
  }
}

async function startYouTubeMix(): Promise<void> {
  const snapshot = state()
  const session = snapshot.youtubeSession
  const from = session.currentDeck
  const to = session.nextDeck
  const current = session.tracks[from]
  const next = session.tracks[to]
  if (current?.source !== 'youtube' || next?.source !== 'youtube') {
    toast('warning', 'Servono due video YouTube caricati per la transizione.')
    return
  }
  if (!session.playing[from]) {
    toast('warning', 'Riproduci il video corrente prima di avviare il mix.')
    return
  }
  if (!youtubeEngine.isReady(from) || !youtubeEngine.isReady(to)) {
    toast('warning', 'I player YouTube si stanno ancora caricando.')
    return
  }
  const plan = buildTransitionPlan(snapshot.transition, null)
  try {
    youtubeEngine.setCrossfader(from, 0, snapshot.settings.crossfaderCurve, true)
    const result = youtubeEngine.startCrossfade(from, to, plan, 0)
    const now = Date.now()
    state().updateSession('youtube', {
      crossfader: 0,
      transitionFrom: from,
      transitionTo: to,
      transitionStartedAt: now,
      transitionEndsAt: now + result.duration * 1_000,
      playing: { ...session.playing, [from]: true, [to]: true },
    })
    state().setPlaying('youtube', to, true)
    toast(
      'info',
      'Fade YouTube avviato. EQ, filtro e waveform non sono disponibili sul flusso IFrame.',
    )
  } catch (error) {
    toast('error', error instanceof Error ? error.message : 'Transizione YouTube non riuscita.')
  }
}

export async function startMix(): Promise<void> {
  const snapshot = state()
  if (snapshot.mode === 'local') await startLocalMix()
  else await startYouTubeMix()
}

export function getPlannedTransitionInfo(): {
  duration: number
  plannedStart: number
  fallback: boolean
} | null {
  const snapshot = state()
  const session = activeSession(snapshot)
  const track = session.tracks[session.currentDeck]
  if (!track) return null
  const bpm = snapshot.mode === 'local' && track.source === 'local' ? track.analysis?.bpm : null
  const plan = buildTransitionPlan(snapshot.transition, bpm)
  const duration =
    snapshot.mode === 'local' && track.source === 'local'
      ? audioEngine.getDuration(session.currentDeck) || track.duration
      : track.duration
  const plannedStart = session.mixStart ?? Math.max(0, duration - Math.min(plan.duration, duration))
  return { duration: duration || 0, plannedStart, fallback: plan.usedFallbackBpm }
}

export function tickAutoMix(): void {
  const snapshot = state()
  if (!snapshot.transition.autoMix) return
  const session = activeSession(snapshot)
  if (session.transitionFrom || !session.playing[session.currentDeck]) return
  const current = session.tracks[session.currentDeck]
  const next = session.tracks[session.nextDeck]
  if (!current || !next) return
  const trackId = current.id
  if (autoMixAttemptedFor === trackId) return

  let duration: number
  let position: number
  if (snapshot.mode === 'local') {
    if (!snapshot.localSession.buffersReady[session.nextDeck]) return
    duration = audioEngine.getDuration(session.currentDeck) || current.duration
    position = audioEngine.getPosition(session.currentDeck)
  } else {
    duration = youtubeEngine.getDuration(session.currentDeck) || current.duration
    position = youtubeEngine.getPosition(session.currentDeck)
  }
  if (duration <= 0) return
  const bpm = current.source === 'local' ? current.analysis?.bpm : null
  const plan = buildTransitionPlan(snapshot.transition, bpm)
  const plannedStart = session.mixStart ?? Math.max(0, duration - Math.min(plan.duration, duration))
  const triggerLead = snapshot.settings.reduceMotion ? 0.05 : 0.2
  if (position >= plannedStart - triggerLead && position < duration - 0.15) {
    autoMixAttemptedFor = trackId
    void startMix()
  }
}

export function resetAutoMixGuard(): void {
  resetAutoMixAttempt()
}

export function getLocalTrackForDeck(deck: DeckId): LocalTrack | null {
  const track = state().localSession.tracks[deck]
  return track && track.source === 'local' ? track : null
}

export async function restoreSession(): Promise<void> {
  const persisted = loadPersistedLocalSession()
  if (!persisted) return
  const snapshot = state()
  const A = persisted.trackIds.A
    ? (snapshot.library.find((item) => item.id === persisted.trackIds.A) ?? null)
    : null
  const B = persisted.trackIds.B
    ? (snapshot.library.find((item) => item.id === persisted.trackIds.B) ?? null)
    : null
  if (!A && !B && persisted.queue.length === 0) return

  state().updateSession('local', {
    currentDeck: persisted.currentDeck,
    nextDeck: persisted.nextDeck,
    tracks: { A, B },
    playing: { A: false, B: false },
    loading: { A: Boolean(A), B: Boolean(B) },
    crossfader: 0,
    mixStart: null,
  })
  state().setLocalQueue(persisted.queue)
  const tasks: Promise<boolean>[] = []
  if (A) tasks.push(hydrateLocalDeck(A, 'A'))
  if (B) tasks.push(hydrateLocalDeck(B, 'B'))
  await Promise.allSettled(tasks)
  audioEngine.setCrossfader(persisted.currentDeck, 0, state().settings.crossfaderCurve, true)
  const missing = [A, B].filter(
    (track) => track !== null && !state().localSession.buffersReady[track === A ? 'A' : 'B'],
  )
  if (missing.length > 0) {
    toast(
      'warning',
      'Alcuni file della sessione precedente non sono più nella cache. Reimportali per riprodurli.',
    )
  }
  persistCurrentSession()
}

export async function initializeApp(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    configureMediaSession()
    state().setHistory(loadHistoryFromStorage())
    state().setAudioState(audioEngine.getContextState())

    engineUnsubscribe = audioEngine.subscribe((event) => {
      if (event.type === 'contextState') {
        state().setAudioState(event.state)
        if (event.state === 'running') state().setAudioUnlocked(true)
        updateMediaMetadata()
        if (event.state === 'suspended') {
          toast('warning', 'Audio sospeso dal browser. Tocca “Riprendi” per continuare.', 6000)
        }
      } else if (event.type === 'error') {
        toast('error', event.message)
      } else if (event.type === 'deckEnded') {
        state().setPlaying('local', event.deck, false)
        const snapshot = state()
        const session = snapshot.localSession
        if (!session.transitionFrom) {
          toast('info', 'Brano terminato. Scegli il prossimo brano e avvia il mix.')
        }
        updateMediaMetadata()
      } else if (event.type === 'transitionEnded') {
        if (!transitionCompletionInFlight) {
          transitionCompletionInFlight = true
          void promoteLocalDeck(event.from, event.to).finally(() => {
            transitionCompletionInFlight = false
          })
        }
      }
    })

    youtubeUnsubscribe = youtubeEngine.subscribe((event) => {
      if (event.type === 'state') {
        if (event.state === 'playing') state().setPlaying('youtube', event.deck, true)
        if (event.state === 'paused' || event.state === 'ended') {
          state().setPlaying('youtube', event.deck, false)
        }
      } else if (event.type === 'error') {
        toast('error', event.message)
      } else if (event.type === 'transitionEnded') {
        if (!transitionCompletionInFlight) {
          transitionCompletionInFlight = true
          void promoteYouTubeDeck(event.from, event.to).finally(() => {
            transitionCompletionInFlight = false
          })
        }
      }
    })

    const onOnline = () => state().setOnline(true)
    const onOffline = () => state().setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    if (!pointerUnlockAttached) {
      pointerUnlockAttached = true
      const unlock = () => {
        void ensureAudioGesture()
      }
      window.addEventListener('pointerdown', unlock, { once: true, capture: true })
    }

    if (!sessionPersistenceStarted) {
      sessionPersistenceStarted = true
      useMixerStore.subscribe((next, previous) => {
        if (
          next.localSession !== previous.localSession ||
          next.localQueue !== previous.localQueue
        ) {
          persistCurrentSession()
        }
        if (
          next.localSession.tracks !== previous.localSession.tracks ||
          next.youtubeSession.tracks !== previous.youtubeSession.tracks ||
          next.mode !== previous.mode
        ) {
          updateMediaMetadata()
        }
      })
    }

    try {
      const library = await listLocalTracks()
      state().setLibrary(library)
      await refreshStorageInfo()
      await restoreSession()
    } catch (error) {
      state().setBootError(
        error instanceof Error
          ? error.message
          : 'Impossibile accedere alla cache locale. La sessione resta disponibile in memoria.',
      )
      toast('warning', 'Cache locale non accessibile. Puoi comunque importare file audio.')
    }

    const params = new URLSearchParams(window.location.search)
    const requestedPanel = params.get('panel')
    if (requestedPanel === 'library' || requestedPanel === 'youtube') {
      state().setPanel(requestedPanel)
      if (requestedPanel === 'youtube') {
        // Keep the local session intact until a video is actually selected.
        state().setPanel('youtube')
      }
    }
  })()
  return initPromise
}

export function disposeApp(): void {
  engineUnsubscribe?.()
  youtubeUnsubscribe?.()
  engineUnsubscribe = null
  youtubeUnsubscribe = null
  analysisClient.dispose()
  audioEngine.releaseAll()
  youtubeEngine.destroyAll()
  initPromise = null
}

export function getYouTubeEngine(): typeof youtubeEngine {
  return youtubeEngine
}

export async function resumeAudio(): Promise<void> {
  await ensureAudioGesture()
  state().setAudioState(audioEngine.getContextState())
}

export async function refreshStorageSummary(): Promise<void> {
  await refreshStorageInfo()
}

export async function requestStoragePersistence(): Promise<void> {
  const persisted = await requestPersistentStorage()
  await refreshStorageInfo()
  toast(
    persisted ? 'success' : 'warning',
    persisted
      ? 'Archiviazione persistente concessa dal browser.'
      : 'Il browser non ha concesso l’archiviazione persistente. La cache può essere svuotata automaticamente.',
  )
}

export function getNextTrackForPlanning() {
  return state().youtubeSession.tracks[state().youtubeSession.nextDeck]
}

export function setYouTubeQueuePlacement(
  item: YouTubeSearchItem,
  placement: 'auto' | 'queue',
): void {
  selectYouTubeTrack(item, placement)
}

export function getTransitionSummary(): string {
  const snapshot = state()
  const plan = buildTransitionPlan(
    snapshot.transition,
    snapshot.mode === 'local' ? currentBpm() : null,
  )
  const fallback = plan.usedFallbackBpm ? ' · BPM 120' : ''
  return `${snapshot.transition.bars} battute · ${formatTransitionLength(plan.duration)}${fallback}`
}

export function getMixAvailability(): { canMix: boolean; reason: string } {
  const snapshot = state()
  const session = activeSession(snapshot)
  if (session.transitionFrom) return { canMix: false, reason: 'Transizione in corso' }
  const current = session.tracks[session.currentDeck]
  const next = session.tracks[session.nextDeck]
  if (!current) return { canMix: false, reason: 'Carica un brano' }
  if (!next) return { canMix: false, reason: 'Aggiungi il prossimo brano' }
  if (!session.playing[session.currentDeck]) {
    return { canMix: false, reason: 'Avvia il brano corrente' }
  }
  if (snapshot.mode === 'local' && !snapshot.localSession.buffersReady[session.nextDeck]) {
    return { canMix: false, reason: 'Prossimo brano in caricamento' }
  }
  return { canMix: true, reason: 'Mix' }
}

// Keep these imported values referenced for consumers using this module in tests.
export { nextBpm, transitionDuration }
