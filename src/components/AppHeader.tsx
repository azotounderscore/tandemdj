import { FolderOpen, MonitorPlay, Music2, Settings2 } from 'lucide-react'
import { haptic } from '../lib/haptics'
import { switchSourceMode } from '../state/controller'
import { activeSession, useMixerStore } from '../state/store'
import { BrandMark } from './BrandMark'

export function AppHeader() {
  const mode = useMixerStore((state) => state.mode)
  const setPanel = useMixerStore((state) => state.setPanel)
  const libraryCount = useMixerStore((state) => state.library.length)
  const transitionActive = useMixerStore((state) => Boolean(activeSession(state).transitionFrom))

  const chooseMode = (next: 'local' | 'youtube') => {
    if (next === mode) return
    haptic(6)
    switchSourceMode(next)
  }

  return (
    <header className="app-header">
      <div className="brand">
        <BrandMark size={34} className="brand-mark" />
        <span className="brand-wordmark">
          Tandem<span>DJ</span>
        </span>
        <span className="beta-chip">beta</span>
      </div>

      <div className="mode-switch" role="group" aria-label="Sorgente audio">
        <button
          type="button"
          className={mode === 'local' ? 'is-active' : ''}
          onClick={() => chooseMode('local')}
          aria-pressed={mode === 'local'}
        >
          <Music2 size={15} strokeWidth={2.2} />
          <span>Locale</span>
        </button>
        <button
          type="button"
          className={mode === 'youtube' ? 'is-active' : ''}
          onClick={() => chooseMode('youtube')}
          aria-pressed={mode === 'youtube'}
        >
          <MonitorPlay size={15} strokeWidth={2.2} />
          <span>YouTube</span>
        </button>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="icon-button header-button"
          onClick={() => setPanel('library')}
          aria-label="Apri libreria locale"
        >
          <FolderOpen size={19} strokeWidth={2.1} />
          {libraryCount > 0 ? <span className="header-count">{libraryCount}</span> : null}
        </button>
        <button
          type="button"
          className="icon-button header-button"
          onClick={() => setPanel('settings')}
          aria-label="Apri impostazioni"
        >
          <Settings2 size={19} strokeWidth={2.1} />
        </button>
      </div>

      {transitionActive ? <span className="header-mix-status">mix in corso</span> : null}
    </header>
  )
}
