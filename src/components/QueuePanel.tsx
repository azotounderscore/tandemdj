import { ListMusic, Plus, Sparkles, Trash2 } from 'lucide-react'
import { haptic } from '../lib/haptics'
import {
  dequeueLocalTrack,
  loadLocalTrackNext,
  loadYouTubeTrackNext,
  removeYouTubeQueueItem,
  toggleAutoMix,
} from '../state/controller'
import { useMixerStore } from '../state/store'
import { Artwork } from './Artwork'
import { BpmValue, CamelotBadge } from './Badges'

export function QueuePanel() {
  const mode = useMixerStore((state) => state.mode)
  const localQueue = useMixerStore((state) => state.localQueue)
  const youtubeQueue = useMixerStore((state) => state.youtubeQueue)
  const library = useMixerStore((state) => state.library)
  const autoMix = useMixerStore((state) => state.transition.autoMix)
  const setPanel = useMixerStore((state) => state.setPanel)

  const localItems = localQueue
    .map((id) => library.find((track) => track.id === id))
    .filter((track): track is NonNullable<typeof track> => Boolean(track))
  const youtubeItems = youtubeQueue
  const items = mode === 'local' ? localItems : youtubeItems
  const visible = items.slice(0, 4)

  return (
    <section className="queue-panel" aria-label="Coda">
      <header className="section-heading">
        <div className="section-title">
          <ListMusic size={17} strokeWidth={2.1} />
          <h2>Coda</h2>
          {items.length > 0 ? <span className="count-pill">{items.length}</span> : null}
        </div>
        <button
          type="button"
          className={`auto-mix-chip${autoMix ? ' is-on' : ''}`}
          onClick={() => {
            haptic(8)
            toggleAutoMix()
          }}
          aria-pressed={autoMix}
        >
          <Sparkles size={13} />
          Auto mix {autoMix ? 'on' : 'off'}
        </button>
      </header>

      {visible.length === 0 ? (
        <div className="queue-empty">
          <span>La coda è vuota. Aggiungi brani senza interrompere il mix.</span>
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => setPanel(mode === 'local' ? 'library' : 'youtube')}
          >
            <Plus size={14} /> Aggiungi
          </button>
        </div>
      ) : (
        <ol className="queue-list">
          {visible.map((item, index) =>
            item.source === 'local' ? (
              <li key={item.id} className="queue-item">
                <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
                <Artwork track={item} size="xs" />
                <button
                  type="button"
                  className="queue-main"
                  onClick={() => {
                    haptic(6)
                    void loadLocalTrackNext(item.id)
                  }}
                >
                  <span className="queue-title">{item.title}</span>
                  <span className="queue-artist">{item.artist}</span>
                </button>
                {item.source === 'local' ? (
                  <span className="queue-stats">
                    <BpmValue bpm={item.analysis?.bpm} />
                    <CamelotBadge camelot={item.analysis?.camelot} />
                  </span>
                ) : null}
                <button
                  type="button"
                  className="icon-button small queue-remove"
                  onClick={() => dequeueLocalTrack(item.id)}
                  aria-label={`Rimuovi ${item.title} dalla coda`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ) : (
              <li key={item.id} className="queue-item">
                <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
                <Artwork track={item} size="xs" />
                <button
                  type="button"
                  className="queue-main"
                  onClick={() => {
                    haptic(6)
                    loadYouTubeTrackNext(item)
                  }}
                >
                  <span className="queue-title">{item.title}</span>
                  <span className="queue-artist">{item.artist}</span>
                </button>
                <span className="fade-only-chip">fade</span>
                <button
                  type="button"
                  className="icon-button small queue-remove"
                  onClick={() => removeYouTubeQueueItem(item.id)}
                  aria-label={`Rimuovi ${item.title} dalla coda`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ),
          )}
        </ol>
      )}
      {items.length > visible.length ? (
        <p className="queue-more">+{items.length - visible.length} altri in coda</p>
      ) : null}
    </section>
  )
}
