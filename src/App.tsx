import { useEffect } from 'react'
import { Headphones, LockKeyhole, Radio } from 'lucide-react'
import { AppHeader } from './components/AppHeader'
import { AutoMixWatcher } from './components/AutoMixWatcher'
import { DeckControlsSheet } from './components/DeckControlsSheet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { KeyboardShortcuts } from './components/KeyboardShortcuts'
import { LibrarySheet } from './components/LibrarySheet'
import { NextTrackCard } from './components/NextTrackCard'
import { PresetDock } from './components/PresetDock'
import { PwaManager } from './components/PwaManager'
import { QueuePanel } from './components/QueuePanel'
import { SettingsSheet } from './components/SettingsSheet'
import { StatusBanners } from './components/StatusBanners'
import { Toasts } from './components/Toasts'
import { TrackHeader } from './components/TrackHeader'
import { TransitionPanel } from './components/TransitionPanel'
import { WaveformStage } from './components/WaveformStage'
import { YouTubeSheet } from './components/YouTubeSheet'
import { YouTubeStage } from './components/YouTubeStage'
import { YouTubeTransitionPanel } from './components/YouTubeTransitionPanel'
import { disposeApp, initializeApp } from './state/controller'
import { useMixerStore } from './state/store'

export default function App() {
  const mode = useMixerStore((state) => state.mode)
  const panel = useMixerStore((state) => state.panel)
  const setPanel = useMixerStore((state) => state.setPanel)
  const reduceMotion = useMixerStore((state) => state.settings.reduceMotion)

  useEffect(() => {
    void initializeApp()
    return () => disposeApp()
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion)
  }, [reduceMotion])

  return (
    <ErrorBoundary>
      <div className="app-shell">
        <div className="ambient-glow" aria-hidden="true" />
        <AppHeader />
        <main className="app-main" id="main">
          <StatusBanners />
          <TrackHeader />
          {mode === 'local' ? <WaveformStage /> : <YouTubeStage />}
          <NextTrackCard />
          {mode === 'local' ? <TransitionPanel /> : <YouTubeTransitionPanel />}
          <QueuePanel />
          <footer className="app-footer">
            <span>
              <LockKeyhole size={13} /> Local-first. I file non lasciano il browser.
            </span>
            <span>
              <Radio size={13} /> YouTube via IFrame ufficiale, solo fade.
            </span>
            <span>
              <Headphones size={13} /> Spazio · C · M · 1–4 per le scorciatoie desktop.
            </span>
          </footer>
        </main>

        <PresetDock />
        <AutoMixWatcher />
        <KeyboardShortcuts />
        <PwaManager />
        <Toasts />

        <LibrarySheet open={panel === 'library'} onClose={() => setPanel(null)} />
        <YouTubeSheet open={panel === 'youtube'} onClose={() => setPanel(null)} />
        <DeckControlsSheet open={panel === 'controls'} onClose={() => setPanel(null)} />
        <SettingsSheet open={panel === 'settings'} onClose={() => setPanel(null)} />
      </div>
    </ErrorBoundary>
  )
}
