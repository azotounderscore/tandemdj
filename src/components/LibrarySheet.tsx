import {
  HardDrive,
  History,
  ListMusic,
  ListPlus,
  Loader2,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { AUDIO_EXTENSIONS, supportsFileSystemAccess } from '../lib/files'
import { formatFileSize, formatRelativeDate, formatTime } from '../lib/format'
import { haptic } from '../lib/haptics'
import {
  chooseFilesWithSystemPicker,
  clearLocalLibrary,
  dequeueLocalTrack,
  enqueueLocalTrack,
  importLocalFiles,
  loadLocalTrackNext,
  removeLocalTrack,
} from '../state/controller'
import { useMixerStore } from '../state/store'
import { Artwork } from './Artwork'
import { BpmValue, CamelotBadge } from './Badges'
import { BottomSheet } from './BottomSheet'

interface LibrarySheetProps {
  open: boolean
  onClose: () => void
}

export function LibrarySheet({ open, onClose }: LibrarySheetProps) {
  const library = useMixerStore((state) => state.library)
  const localQueue = useMixerStore((state) => state.localQueue)
  const history = useMixerStore((state) => state.history)
  const importing = useMixerStore((state) => state.importing)
  const analysisProgress = useMixerStore((state) => state.analysisProgress)
  const storageUsage = useMixerStore((state) => state.storageUsage)
  const storageQuota = useMixerStore((state) => state.storageQuota)
  const localSession = useMixerStore((state) => state.localSession)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return library
    return library.filter(
      (track) =>
        track.title.toLowerCase().includes(needle) ||
        track.artist.toLowerCase().includes(needle) ||
        track.fileName.toLowerCase().includes(needle),
    )
  }, [library, query])

  const queuedTracks = localQueue
    .map((id) => library.find((track) => track.id === id))
    .filter((track): track is NonNullable<typeof track> => Boolean(track))
  const offlineBytes = library.reduce((total, track) => total + track.offlineBytes, 0)
  const storagePercent =
    storageQuota > 0 ? Math.min(100, Math.round((storageUsage / storageQuota) * 100)) : 0
  const transitionActive = Boolean(localSession.transitionFrom)

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return
    void importLocalFiles(files)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    handleFiles(Array.from(event.dataTransfer.files))
  }

  const toggleClear = () => {
    if (transitionActive) return
    if (!confirmClear) {
      setConfirmClear(true)
      window.setTimeout(() => setConfirmClear(false), 3500)
      return
    }
    setConfirmClear(false)
    void clearLocalLibrary()
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="La tua libreria"
      subtitle="I file restano su questo dispositivo. Nessun upload."
      size="wide"
    >
      <div
        className={`import-zone${dragActive ? ' is-dragging' : ''}${importing ? ' is-importing' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={AUDIO_EXTENSIONS.join(',')}
          className="sr-only"
          onChange={(event) => {
            handleFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <span className="import-icon">
          {importing ? <Loader2 size={22} className="spin" /> : <UploadCloud size={22} />}
        </span>
        <div className="import-copy">
          <strong>{importing ? 'Importazione e analisi in corso…' : 'Importa audio'}</strong>
          <span>MP3, WAV, OGG, M4A, FLAC · max 160 MB · max 15 min</span>
        </div>
        <div className="import-actions">
          <button
            type="button"
            className="primary-button compact"
            onClick={() => inputRef.current?.click()}
            disabled={importing}
          >
            Scegli file
          </button>
          {supportsFileSystemAccess() ? (
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => void chooseFilesWithSystemPicker()}
              disabled={importing}
            >
              Selettore di sistema
            </button>
          ) : null}
        </div>
        <p className="import-hint">Puoi anche trascinare i file qui sopra.</p>
      </div>

      <div className="library-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Cerca tra ${library.length} brani…`}
          aria-label="Cerca nella libreria"
        />
      </div>

      <section className="library-section">
        <header className="sheet-section-heading">
          <span>Libreria</span>
          <span>{filtered.length} brani</span>
        </header>
        {filtered.length === 0 ? (
          <div className="library-empty">
            <HardDrive size={24} />
            <strong>{library.length === 0 ? 'La libreria è vuota' : 'Nessun risultato'}</strong>
            <span>
              {library.length === 0
                ? 'Importa almeno due brani per iniziare a mixare.'
                : 'Prova con un altro titolo, artista o nome file.'}
            </span>
          </div>
        ) : (
          <ul className="library-list">
            {filtered.map((track) => {
              const progress = analysisProgress[track.id]
              const onDeck =
                localSession.tracks.A?.id === track.id || localSession.tracks.B?.id === track.id
              return (
                <li key={track.id} className="library-row">
                  <Artwork track={track} size="sm" />
                  <button
                    type="button"
                    className="library-main"
                    onClick={() => {
                      haptic(5)
                      void loadLocalTrackNext(track.id)
                    }}
                    title={onDeck ? 'Già caricato su un deck' : 'Carica sul mixer'}
                  >
                    <span className="library-title">{track.title}</span>
                    <span className="library-artist">{track.artist}</span>
                    <span className="library-meta">
                      {progress ? (
                        <span className="analysis-progress">
                          <span className="analysis-bar">
                            <span style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                          </span>
                          {progress.stage}
                        </span>
                      ) : (
                        <>
                          {track.analysis ? (
                            <>
                              <BpmValue bpm={track.analysis.bpm} />
                              <CamelotBadge camelot={track.analysis.camelot} />
                            </>
                          ) : (
                            <span className="library-nokey">waveform in attesa</span>
                          )}
                          <span>{formatTime(track.duration)}</span>
                          <span className="library-size">{formatFileSize(track.fileSize)}</span>
                          {track.hasBlob ? (
                            <span className="offline-flag" title="Disponibile offline">
                              <HardDrive size={10} /> offline
                            </span>
                          ) : (
                            <span
                              className="session-flag"
                              title="Nella cache del browser non c'è il file"
                            >
                              solo sessione
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </button>
                  <div className="library-actions">
                    <button
                      type="button"
                      className="icon-button small"
                      onClick={() => {
                        haptic(4)
                        enqueueLocalTrack(track.id)
                      }}
                      aria-label={`Aggiungi ${track.title} alla coda`}
                      title="Aggiungi alla coda"
                    >
                      <ListPlus size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button small danger"
                      onClick={() => void removeLocalTrack(track.id)}
                      aria-label={`Rimuovi ${track.title}`}
                      title="Rimuovi dalla libreria"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="library-section">
        <header className="sheet-section-heading">
          <span>
            <ListMusic size={14} /> Coda locale
          </span>
          <span>{queuedTracks.length}</span>
        </header>
        {queuedTracks.length === 0 ? (
          <p className="sheet-muted">La coda è vuota. Usa il pulsante + su un brano.</p>
        ) : (
          <ol className="sheet-queue">
            {queuedTracks.map((track, index) => (
              <li key={track.id}>
                <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
                <button
                  type="button"
                  className="sheet-queue-main"
                  onClick={() => void loadLocalTrackNext(track.id)}
                >
                  {track.title}
                  <span>{track.artist}</span>
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() => dequeueLocalTrack(track.id)}
                  aria-label={`Rimuovi ${track.title} dalla coda`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {history.length > 0 ? (
        <section className="library-section">
          <header className="sheet-section-heading">
            <span>
              <History size={14} /> Cronologia
            </span>
            <span>ultimi {Math.min(8, history.length)}</span>
          </header>
          <ul className="history-list">
            {history.slice(0, 8).map((entry) => (
              <li key={entry.id}>
                <span className="history-dot" data-source={entry.source} aria-hidden="true" />
                <span className="history-copy">
                  <span>{entry.title}</span>
                  <small>
                    {entry.artist} · {formatRelativeDate(entry.mixedAt)}
                  </small>
                </span>
                {entry.bpm ? (
                  <span className="history-bpm">{Math.round(entry.bpm)} bpm</span>
                ) : null}
                {entry.camelot ? <CamelotBadge camelot={entry.camelot} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="storage-card">
        <div className="storage-head">
          <span>
            <HardDrive size={15} /> Archiviazione locale
          </span>
          <span>{formatFileSize(offlineBytes)} audio</span>
        </div>
        <div className="storage-track">
          <span style={{ width: `${storagePercent}%` }} />
        </div>
        <p>
          {storageQuota > 0
            ? `${formatFileSize(storageUsage)} usati su ${formatFileSize(storageQuota)} disponibili.`
            : 'Il browser non espone una stima dello spazio disponibile.'}
        </p>
      </section>

      <div className="sheet-danger-row">
        <button
          type="button"
          className={`danger-button${confirmClear ? ' is-armed' : ''}`}
          onClick={toggleClear}
          disabled={transitionActive || library.length === 0}
        >
          <Trash2 size={14} />
          {confirmClear ? 'Tocca ancora per confermare' : 'Svuota libreria locale'}
        </button>
        <span>La coda e i metadati locali verranno rimossi.</span>
      </div>
    </BottomSheet>
  )
}
