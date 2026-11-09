import type { YouTubePlaylist, YouTubeSearchItem } from '../types'

export const YOUTUBE_API_KEY =
  (import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined)?.trim() ?? ''
export const GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? ''
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly'

export class YouTubeApiError extends Error {
  readonly status: number

  constructor(message: string, status = 0) {
    super(message)
    this.name = 'YouTubeApiError'
    this.status = status
  }
}

export function youtubeDataApiConfigured(): boolean {
  return YOUTUBE_API_KEY.length > 0
}

export function googleSignInConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0
}

interface YouTubeThumbnail {
  url?: string
  width?: number
  height?: number
}

interface YouTubeSearchResponse {
  items?: Array<{
    id?: { videoId?: string }
    snippet?: {
      title?: string
      channelTitle?: string
      thumbnails?: Record<string, YouTubeThumbnail>
    }
  }>
  error?: { message?: string; errors?: Array<{ reason?: string }> }
}

interface YouTubeVideoItem {
  id?: string
  snippet?: {
    title?: string
    channelTitle?: string
    thumbnails?: Record<string, YouTubeThumbnail>
  }
  contentDetails?: { duration?: string }
  status?: { embeddable?: boolean; privacyStatus?: string }
}

interface YouTubeVideosResponse {
  items?: YouTubeVideoItem[]
  error?: { message?: string; errors?: Array<{ reason?: string }> }
}

interface YouTubePlaylistItem {
  snippet?: {
    title?: string
    videoOwnerChannelTitle?: string
    channelTitle?: string
    resourceId?: { videoId?: string }
    thumbnails?: Record<string, YouTubeThumbnail>
  }
  contentDetails?: { videoId?: string }
}

interface YouTubePlaylistItemsResponse {
  items?: YouTubePlaylistItem[]
  nextPageToken?: string
  error?: { message?: string; errors?: Array<{ reason?: string }> }
}

interface YouTubePlaylistsResponse {
  items?: Array<{
    id?: string
    snippet?: {
      title?: string
      description?: string
      thumbnails?: Record<string, YouTubeThumbnail>
    }
    contentDetails?: { itemCount?: number }
  }>
  error?: { message?: string; errors?: Array<{ reason?: string }> }
}

interface YouTubeChannelsResponse {
  items?: Array<{
    snippet?: {
      title?: string
      thumbnails?: Record<string, YouTubeThumbnail>
    }
  }>
}

function apiError(response: Response, payload: unknown): YouTubeApiError {
  const data = payload as {
    error?: { message?: string; errors?: Array<{ reason?: string }> }
  }
  const reason = data?.error?.errors?.[0]?.reason
  if (reason === 'quotaExceeded') {
    return new YouTubeApiError(
      'Quota YouTube Data API esaurita. Riprova domani o usa un video tramite URL.',
      response.status,
    )
  }
  if (reason === 'keyInvalid' || reason === 'badRequest') {
    return new YouTubeApiError(
      'API key YouTube non valida o non abilitata per YouTube Data API v3.',
      response.status,
    )
  }
  if (response.status === 401) {
    return new YouTubeApiError('Sessione Google scaduta. Accedi di nuovo.', 401)
  }
  if (response.status === 403) {
    return new YouTubeApiError(
      'Accesso YouTube negato. Controlla API key, quota e permessi OAuth.',
      403,
    )
  }
  return new YouTubeApiError(
    data?.error?.message ?? `Errore YouTube Data API (${response.status})`,
    response.status,
  )
}

async function googleApi<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
  accessToken?: string,
): Promise<T> {
  const search = new URLSearchParams(params)
  if (!accessToken) search.set('key', YOUTUBE_API_KEY)
  if (!accessToken && !YOUTUBE_API_KEY) {
    throw new YouTubeApiError('Configura VITE_YOUTUBE_API_KEY per cercare su YouTube.')
  }
  let response: Response
  try {
    response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${search.toString()}`, {
      signal,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new YouTubeApiError('Rete non disponibile. Riprova quando sei online.')
  }
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) throw apiError(response, payload)
  return payload as T
}

function pickThumbnail(thumbnails: Record<string, YouTubeThumbnail> | undefined): string {
  return thumbnails?.medium?.url ?? thumbnails?.high?.url ?? thumbnails?.default?.url ?? ''
}

function decodeHtml(value: string): string {
  if (typeof document === 'undefined') return value
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

export function parseIsoDuration(value: string | undefined): number {
  if (!value) return 0
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value)
  if (!match) return 0
  const days = Number(match[1] ?? 0)
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3] ?? 0)
  const seconds = Number(match[4] ?? 0)
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds
}

function mapVideoItem(item: YouTubeVideoItem): YouTubeSearchItem | null {
  if (!item.id || !item.snippet) return null
  if (item.status?.embeddable === false) return null
  if (item.status?.privacyStatus && item.status.privacyStatus !== 'public') return null
  return {
    videoId: item.id,
    title: decodeHtml(item.snippet.title ?? 'Video YouTube'),
    artist: decodeHtml(item.snippet.channelTitle ?? 'YouTube'),
    duration: parseIsoDuration(item.contentDetails?.duration),
    thumbnail: pickThumbnail(item.snippet.thumbnails),
  }
}

async function fetchVideoDetails(
  ids: string[],
  signal?: AbortSignal,
  accessToken?: string,
): Promise<Map<string, YouTubeSearchItem>> {
  const result = new Map<string, YouTubeSearchItem>()
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50))
  for (const chunk of chunks) {
    if (chunk.length === 0) continue
    const data = await googleApi<YouTubeVideosResponse>(
      'videos',
      {
        part: 'snippet,contentDetails,status',
        id: chunk.join(','),
        maxResults: '50',
      },
      signal,
      accessToken,
    )
    for (const item of data.items ?? []) {
      const mapped = mapVideoItem(item)
      if (mapped) result.set(mapped.videoId, mapped)
    }
  }
  return result
}

export async function searchYouTubeVideos(
  query: string,
  signal?: AbortSignal,
): Promise<YouTubeSearchItem[]> {
  const clean = query.trim()
  if (clean.length < 2) return []
  const search = await googleApi<YouTubeSearchResponse>(
    'search',
    {
      part: 'snippet',
      type: 'video',
      maxResults: '16',
      videoCategoryId: '10',
      videoEmbeddable: 'true',
      q: clean,
      safeSearch: 'none',
    },
    signal,
  )
  const ids = (search.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => typeof id === 'string')
  if (ids.length === 0) return []
  const details = await fetchVideoDetails(ids, signal)
  return ids.map((id) => details.get(id)).filter((item): item is YouTubeSearchItem => Boolean(item))
}

export interface ParsedYouTubeLink {
  videoId: string | null
  playlistId: string | null
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,60}$/

export function parseYouTubeLink(input: string): ParsedYouTubeLink | null {
  const trimmed = input.trim()
  if (VIDEO_ID.test(trimmed)) return { videoId: trimmed, playlistId: null }
  if (PLAYLIST_ID.test(trimmed) && (trimmed.startsWith('PL') || trimmed.startsWith('UU'))) {
    return { videoId: null, playlistId: trimmed }
  }
  let url: URL
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, '')
  if (!['youtube.com', 'youtu.be', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    return null
  }
  let videoId: string | null = null
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? null
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v')
  } else {
    const parts = url.pathname.split('/').filter(Boolean)
    if (['shorts', 'embed', 'live'].includes(parts[0] ?? '')) videoId = parts[1] ?? null
  }
  const playlistId = url.searchParams.get('list')
  if (videoId && !VIDEO_ID.test(videoId)) videoId = null
  if (playlistId && !PLAYLIST_ID.test(playlistId)) {
    return videoId ? { videoId, playlistId: null } : null
  }
  if (!videoId && !playlistId) return null
  return { videoId, playlistId }
}

export async function getVideoByLink(
  link: ParsedYouTubeLink,
  signal?: AbortSignal,
): Promise<YouTubeSearchItem | null> {
  if (!link.videoId) return null
  if (!youtubeDataApiConfigured()) {
    return {
      videoId: link.videoId,
      title: 'Video YouTube',
      artist: 'Caricato tramite URL',
      duration: 0,
      thumbnail: `https://i.ytimg.com/vi/${link.videoId}/hqdefault.jpg`,
    }
  }
  const details = await fetchVideoDetails([link.videoId], signal)
  return details.get(link.videoId) ?? null
}

export async function getPlaylistByLink(
  playlistId: string,
  signal?: AbortSignal,
): Promise<{ playlist: YouTubePlaylist; items: YouTubeSearchItem[] }> {
  if (!youtubeDataApiConfigured()) {
    throw new YouTubeApiError('Configura VITE_YOUTUBE_API_KEY per caricare una playlist.')
  }
  const playlistData = await googleApi<YouTubePlaylistsResponse>(
    'playlists',
    { part: 'snippet,contentDetails', id: playlistId, maxResults: '1' },
    signal,
  )
  const rawPlaylist = playlistData.items?.[0]
  if (!rawPlaylist?.id) throw new YouTubeApiError('Playlist non trovata o non pubblica')
  const itemsData = await googleApi<YouTubePlaylistItemsResponse>(
    'playlistItems',
    {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: '25',
    },
    signal,
  )
  const videoIds = (itemsData.items ?? [])
    .map((item) => item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId)
    .filter((id): id is string => typeof id === 'string')
  const details = await fetchVideoDetails(videoIds, signal)
  return {
    playlist: {
      id: playlistId,
      title: decodeHtml(rawPlaylist.snippet?.title ?? 'Playlist YouTube'),
      description: decodeHtml(rawPlaylist.snippet?.description ?? ''),
      thumbnail: pickThumbnail(rawPlaylist.snippet?.thumbnails),
      itemCount: rawPlaylist.contentDetails?.itemCount ?? videoIds.length,
    },
    items: videoIds
      .map((id) => details.get(id))
      .filter((item): item is YouTubeSearchItem => Boolean(item)),
  }
}

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void
}

interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (response: GoogleTokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }) => GoogleTokenClient
  revoke: (token: string, callback: () => void) => void
}

interface GoogleIdentity {
  accounts: {
    oauth2: GoogleOAuth2
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

let accessToken: string | null = null
let tokenExpiresAt = 0
let gisPromise: Promise<void> | null = null

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve()
      else reject(new YouTubeApiError('Google Identity Services non disponibile'))
    }
    script.onerror = () => {
      gisPromise = null
      reject(new YouTubeApiError('Impossibile caricare Google Identity Services. Sei online?'))
    }
    document.head.appendChild(script)
  })
  return gisPromise
}

export interface GoogleAccount {
  name: string
  picture: string
}

export async function signInToGoogle(): Promise<GoogleAccount> {
  if (!googleSignInConfigured()) {
    throw new YouTubeApiError('Configura VITE_GOOGLE_CLIENT_ID per accedere a Google.')
  }
  await loadGoogleIdentity()
  const google = window.google
  if (!google) throw new YouTubeApiError('Google Identity Services non disponibile')

  const token = await new Promise<GoogleTokenResponse>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: YOUTUBE_READONLY_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new YouTubeApiError(
              response.error_description ?? 'Accesso Google annullato o non autorizzato',
            ),
          )
          return
        }
        resolve(response)
      },
      error_callback: (error) => {
        reject(new YouTubeApiError(error.message ?? 'Accesso Google non riuscito'))
      },
    })
    client.requestAccessToken({ prompt: '' })
  })

  if (!token.access_token) throw new YouTubeApiError('Token Google non ricevuto')
  accessToken = token.access_token
  tokenExpiresAt = Date.now() + (token.expires_in ?? 3_600) * 1_000
  try {
    return await fetchGoogleAccount()
  } catch (error) {
    accessToken = null
    tokenExpiresAt = 0
    throw error
  }
}

export async function fetchGoogleAccount(): Promise<GoogleAccount> {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    throw new YouTubeApiError('Accedi di nuovo a Google per continuare.')
  }
  const data = await googleApi<YouTubeChannelsResponse>(
    'channels',
    { part: 'snippet', mine: 'true' },
    undefined,
    accessToken,
  )
  const snippet = data.items?.[0]?.snippet
  return {
    name: snippet?.title ?? 'Account YouTube',
    picture: pickThumbnail(snippet?.thumbnails),
  }
}

export function hasGoogleAccessToken(): boolean {
  return Boolean(accessToken && Date.now() < tokenExpiresAt)
}

export function signOutOfGoogle(): void {
  const token = accessToken
  accessToken = null
  tokenExpiresAt = 0
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {})
  }
}

export async function getMyYouTubePlaylists(signal?: AbortSignal): Promise<YouTubePlaylist[]> {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    throw new YouTubeApiError('Accedi con Google per vedere le tue playlist.', 401)
  }
  const data = await googleApi<YouTubePlaylistsResponse>(
    'playlists',
    {
      part: 'snippet,contentDetails',
      mine: 'true',
      maxResults: '25',
    },
    signal,
    accessToken,
  )
  return (data.items ?? [])
    .filter((item): item is typeof item & { id: string } => Boolean(item.id))
    .map((item) => ({
      id: item.id,
      title: decodeHtml(item.snippet?.title ?? 'Playlist'),
      description: decodeHtml(item.snippet?.description ?? ''),
      thumbnail: pickThumbnail(item.snippet?.thumbnails),
      itemCount: item.contentDetails?.itemCount ?? 0,
    }))
}

export async function getMyPlaylistItems(
  playlistId: string,
  signal?: AbortSignal,
): Promise<YouTubeSearchItem[]> {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    throw new YouTubeApiError('Accedi con Google per caricare la playlist.', 401)
  }
  const itemsData = await googleApi<YouTubePlaylistItemsResponse>(
    'playlistItems',
    { part: 'snippet,contentDetails', playlistId, maxResults: '25' },
    signal,
    accessToken,
  )
  const ids = (itemsData.items ?? [])
    .map((item) => item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId)
    .filter((id): id is string => typeof id === 'string')
  const details = await fetchVideoDetails(ids, signal, accessToken)
  return ids.map((id) => details.get(id)).filter((item): item is YouTubeSearchItem => Boolean(item))
}

export function youtubeThumbnail(videoId: string, quality = 'hqdefault'): string {
  return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`
}
