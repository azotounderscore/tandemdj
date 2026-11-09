import { AlertTriangle, CloudOff, Volume2, WifiOff } from 'lucide-react'
import { resumeAudio } from '../state/controller'
import { useMixerStore } from '../state/store'

export function StatusBanners() {
  const bootError = useMixerStore((state) => state.bootError)
  const isOnline = useMixerStore((state) => state.isOnline)
  const audioState = useMixerStore((state) => state.audioState)
  const mode = useMixerStore((state) => state.mode)

  return (
    <div className="status-banners">
      {bootError ? (
        <div className="banner banner-warning" role="alert">
          <AlertTriangle size={16} />
          <span>{bootError}</span>
        </div>
      ) : null}

      {!isOnline ? (
        <div className="banner banner-offline" role="status">
          <WifiOff size={16} />
          <span>
            Sei offline. La libreria locale e la UI restano disponibili
            {mode === 'youtube' ? '; i player YouTube no.' : '.'}
          </span>
          {mode === 'youtube' ? <CloudOff size={15} className="banner-extra" /> : null}
        </div>
      ) : null}

      {audioState === 'suspended' ? (
        <div className="banner banner-audio" role="status">
          <Volume2 size={16} />
          <span>Il browser ha sospeso l’audio.</span>
          <button type="button" className="banner-action" onClick={() => void resumeAudio()}>
            Riprendi
          </button>
        </div>
      ) : null}
    </div>
  )
}
