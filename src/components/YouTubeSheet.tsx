import {
  AlertTriangle,
  Check,
  ExternalLink,
  ListMusic,
  ListPlus,
  Loader2,
  LogIn,
  LogOut,
  MonitorPlay,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { formatTime } from '../lib/format'
import { haptic } from '../lib/haptics'
import {
  getMyPlaylistItems,
  getMyYouTubePlaylists,
  getPlaylistByLink,
  getVideoByLink,
  googleSignInConfigured,
  parseYouTubeLink,
  searchYouTubeVideos,
  signInToGoogle,
  signOutOfGoogle,
  youtubeDataApiConfigured,
  youtubeThumbnail,
} from '../lib/youtube-api'
import {
  loadYouTubeTrackNext,
  removeYouTubeQueueItem,
  selectYouTubeTrack,
  setYouTubeAccount,
} from '../state/controller'
import { useMixerStore } from '../state/store'
import type { YouTubePlaylist, YouTubeSearchItem } from '../types'
import { BottomSheet } from './BottomSheet'

interface YouTubeSheetProps {
  open: boolean
  onClose: () => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Operazione YouTube non riuscita.'
}

export function YouTubeSheet({ open, onClose }: YouTubeSheetProps) {
  const account = useMixerStore((state) => state.youtubeAccount)
  const authBusy = useMixerStore((state) => state.youtubeAuthBusy)
  const setAuthBusy = useMixerStore((state) => state.setYouTubeAuthBusy)
  const queue = useMixerStore((state) => state.youtubeQueue)
  const isOnline = useMixerStore((state) => state.isOnline)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<YouTubeSearchItem[]>([])
  const [resultsLabel, setResultsLabel] = useState('')
  const [playlists, setPlaylists] = useState<YouTubePlaylist[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const apiReady = youtubeDataApiConfigured()
  const signInReady = googleSignInConfigured()

  useEffect(() => {
    if (!open) abortRef.current?.abort()
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  const runSearch = async (event: FormEvent) => {
    event.preventDefault()
    const clean = term.trim()
    if (!clean) {
      setError('Incolla un link YouTube oppure cerca un video.')
      return
    }
    setError(null)
    setNote(null)

    const link = parseYouTubeLink(clean)
    if (link) {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setBusy(true)
      try {
        if (link.videoId) {
          const item = await getVideoByLink(link, controller.signal)
          if (!item) {
            setError('Video non trovato o non pubblico.')
            return
          }
          haptic(6)
          selectYouTubeTrack(item)
          onClose()
          return
        }
        if (link.playlistId) {
          const data = await getPlaylistByLink(link.playlistId, controller.signal)
          setResults(data.items)
          setResultsLabel(`Playlist · ${data.playlist.title}`)
          if (data.items.length === 0) setNote('La playlist non contiene video riproducibili.')
        }
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
          setError(errorText(caught))
        }
      } finally {
        setBusy(false)
      }
      return
    }

    if (/youtu\.?be/i.test(clean)) {
      setError('Link YouTube non riconosciuto. Controlla l’URL e riprova.')
      return
    }
    if (!apiReady) {
      setError(
        'La ricerca richiede VITE_YOUTUBE_API_KEY. Puoi comunque incollare un link diretto a un video.',
      )
      return
    }
    if (clean.length < 2) {
      setError('Scrivi almeno 2 caratteri.')
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    try {
      const items = await searchYouTubeVideos(clean, controller.signal)
      setResults(items)
      setResultsLabel(`Ricerca · “${clean}”`)
      if (items.length === 0) setNote('Nessun video incorporabile trovato per questa ricerca.')
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(errorText(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleSignIn = async () => {
    setError(null)
    setNote(null)
    setAuthBusy(true)
    try {
      const nextAccount = await signInToGoogle()
      setYouTubeAccount(nextAccount)
      haptic(8)
      try {
        const ownPlaylists = await getMyYouTubePlaylists()
        setPlaylists(ownPlaylists)
        setNote(
          ownPlaylists.length > 0
            ? `${ownPlaylists.length} playlist trovate sul tuo canale.`
            : 'Accesso riuscito, ma non ci sono playlist pubbliche o private visibili.',
        )
      } catch (caught) {
        setError(errorText(caught))
      }
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSignOut = () => {
    signOutOfGoogle()
    setYouTubeAccount(null)
    setPlaylists([])
    setNote('Accesso Google rimosso. Il token restava solo in memoria.')
  }

  const refreshPlaylists = async () => {
    if (!account) {
      setError('Accedi con Google per caricare le tue playlist.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      setPlaylists(await getMyYouTubePlaylists())
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const openPlaylist = async (playlist: YouTubePlaylist) => {
    setError(null)
    setBusy(true)
    try {
      const items = await getMyPlaylistItems(playlist.id)
      setResults(items)
      setResultsLabel(`Playlist · ${playlist.title}`)
      if (items.length === 0) setNote('Questa playlist non contiene video incorporabili.')
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const loadItem = (item: YouTubeSearchItem) => {
    haptic(6)
    selectYouTubeTrack(item, 'auto')
    onClose()
  }

  const queueItem = (item: YouTubeSearchItem) => {
    haptic(4)
    selectYouTubeTrack(item, 'queue')
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="YouTube"
      subtitle="Player IFrame ufficiale · nessun download o scraping"
      size="wide"
    >
      {!isOnline ? (
        <div className="sheet-alert">
          <AlertTriangle size={16} />
          <span>Sei offline. I player YouTube richiedono una connessione.</span>
        </div>
      ) : null}

      {!apiReady ? (
        <div className="setup-note">
          <span className="setup-note-dot" aria-hidden="true" />
          <div>
            <strong>Solo link diretti abilitati</strong>
            <p>
              Ricerca e playlist richiedono <code>VITE_YOUTUBE_API_KEY</code>. I video tramite URL
              funzionano già con il player IFrame, senza API key.
            </p>
          </div>
        </div>
      ) : null}

      <form className="yt-search-form" onSubmit={(event) => void runSearch(event)}>
        <div className="yt-search-input">
          <Search size={17} aria-hidden="true" />
          <input
            type="text"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={
              apiReady ? 'Cerca un video o incolla un link YouTube…' : 'Incolla un link YouTube…'
            }
            aria-label="Cerca o incolla un link YouTube"
            autoComplete="off"
            spellCheck={false}
          />
          {term ? (
            <button
              type="button"
              className="clear-input"
              onClick={() => setTerm('')}
              aria-label="Cancella campo"
            >
              ×
            </button>
          ) : null}
        </div>
        <button type="submit" className="primary-button" disabled={busy || !isOnline}>
          {busy ? <Loader2 size={16} className="spin" /> : <MonitorPlay size={16} />}
          {busy ? 'Carico…' : 'Apri'}
        </button>
      </form>

      {error ? (
        <div className="sheet-alert is-error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : null}
      {note ? <p className="sheet-note">{note}</p> : null}

      <section className="yt-account">
        {account ? (
          <>
            <span className="yt-avatar">
              {account.picture ? (
                <img src={account.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                <LogIn size={16} />
              )}
            </span>
            <div className="yt-account-copy">
              <strong>{account.name}</strong>
              <span>Accesso limitato alla lettura del canale</span>
            </div>
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => void refreshPlaylists()}
              disabled={busy}
            >
              <RefreshCw size={13} /> Playlist
            </button>
            <button
              type="button"
              className="icon-button small"
              onClick={handleSignOut}
              aria-label="Esci da Google"
            >
              <LogOut size={15} />
            </button>
          </>
        ) : (
          <>
            <div className="yt-account-copy">
              <strong>Le tue playlist</strong>
              <span>
                {signInReady
                  ? 'Accesso opzionale, solo lettura. Il token resta in memoria.'
                  : 'Configura VITE_GOOGLE_CLIENT_ID per collegare il tuo canale.'}
              </span>
            </div>
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => void handleSignIn()}
              disabled={!signInReady || authBusy || !isOnline}
            >
              {authBusy ? <Loader2 size={13} className="spin" /> : <LogIn size={13} />}
              {authBusy ? 'Accesso…' : 'Accedi con Google'}
            </button>
          </>
        )}
      </section>

      {account && playlists.length > 0 ? (
        <section className="library-section">
          <header className="sheet-section-heading">
            <span>Le tue playlist</span>
            <span>{playlists.length}</span>
          </header>
          <ul className="yt-playlist-list">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <button type="button" onClick={() => void openPlaylist(playlist)} disabled={busy}>
                  <span className="yt-playlist-thumb">
                    {playlist.thumbnail ? (
                      <img
                        src={playlist.thumbnail}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <ListMusic size={18} />
                    )}
                  </span>
                  <span className="yt-playlist-copy">
                    <strong>{playlist.title}</strong>
                    <small>{playlist.itemCount} video</small>
                  </span>
                  <ExternalLink size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {results.length > 0 ? (
        <section className="library-section">
          <header className="sheet-section-heading">
            <span>{resultsLabel}</span>
            <span>{results.length}</span>
          </header>
          <ul className="yt-result-list">
            {results.map((item) => (
              <li key={item.videoId} className="yt-result">
                <span className="yt-result-thumb">
                  <img
                    src={item.thumbnail || youtubeThumbnail(item.videoId)}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none'
                    }}
                  />
                </span>
                <button type="button" className="yt-result-main" onClick={() => loadItem(item)}>
                  <span className="yt-result-title">{item.title}</span>
                  <span className="yt-result-artist">{item.artist}</span>
                  <span className="yt-result-meta">
                    {item.duration > 0 ? formatTime(item.duration) : 'durata IFrame'} ·
                    incorporabile
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() => queueItem(item)}
                  aria-label={`Aggiungi ${item.title} alla coda`}
                  title="Aggiungi alla coda"
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  className="yt-result-load"
                  onClick={() => loadItem(item)}
                  aria-label={`Carica ${item.title}`}
                  title="Carica sul deck"
                >
                  <MonitorPlay size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="yt-empty">
          <MonitorPlay size={26} />
          <strong>{resultsLabel ? 'Nessun risultato' : 'Cerca il prossimo video'}</strong>
          <p>
            Incolla un URL <span>youtube.com/watch?v=…</span>, <span>youtu.be/…</span> o una
            playlist pubblica. Se configuri la Data API puoi anche cercare per testo.
          </p>
          <div className="yt-empty-chips" aria-hidden="true">
            <span>disco</span>
            <span>house</span>
            <span>boiler room</span>
            <span>radio mix</span>
          </div>
        </div>
      )}

      <section className="library-section">
        <header className="sheet-section-heading">
          <span>
            <ListMusic size={14} /> Coda YouTube
          </span>
          <span>{queue.length}</span>
        </header>
        {queue.length === 0 ? (
          <p className="sheet-muted">Nessun video in coda.</p>
        ) : (
          <ol className="sheet-queue">
            {queue.map((item, index) => (
              <li key={item.id}>
                <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
                <button
                  type="button"
                  className="sheet-queue-main"
                  onClick={() => {
                    loadYouTubeTrackNext(item)
                    onClose()
                  }}
                >
                  {item.title}
                  <span>{item.artist}</span>
                </button>
                <span className="fade-only-chip">fade</span>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() => removeYouTubeQueueItem(item.id)}
                  aria-label={`Rimuovi ${item.title} dalla coda`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="yt-compliance">
        <Check size={15} />
        <span>
          Riproduzione tramite YouTube IFrame Player API ufficiale. Nessun download, nessuna
          estrazione audio, nessun bypass DRM. I video non incorporabili vengono filtrati quando la
          Data API è configurata.
        </span>
      </div>

      <p className="sheet-muted yt-key-hint">
        <ListPlus size={12} /> La coda mantiene i video selezionati; il player li carica solo quando
        diventano deck attivo o prossimo.
      </p>
    </BottomSheet>
  )
}
