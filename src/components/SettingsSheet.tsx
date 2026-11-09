import {
  CheckCircle2,
  Database,
  ExternalLink,
  HardDrive,
  Info,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { formatFileSize } from '../lib/format'
import { haptic } from '../lib/haptics'
import { googleSignInConfigured, youtubeDataApiConfigured } from '../lib/youtube-api'
import {
  applyTransitionSettings,
  refreshStorageSummary,
  requestStoragePersistence,
  setMasterVolume,
} from '../state/controller'
import { useMixerStore } from '../state/store'
import { BottomSheet } from './BottomSheet'
import { RangeField } from './RangeField'
import { Toggle } from './Toggle'

interface SettingsSheetProps {
  open: boolean
  onClose: () => void
}

const CAP_OPTIONS = [64, 128, 220, 512, 1024]

export function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  const settings = useMixerStore((state) => state.settings)
  const setSettings = useMixerStore((state) => state.setSettings)
  const storageUsage = useMixerStore((state) => state.storageUsage)
  const storageQuota = useMixerStore((state) => state.storageQuota)
  const storagePersisted = useMixerStore((state) => state.storagePersisted)
  const library = useMixerStore((state) => state.library)
  const pushToast = useMixerStore((state) => state.pushToast)
  const offlineBytes = library.reduce((total, track) => total + track.offlineBytes, 0)
  const storagePercent =
    storageQuota > 0 ? Math.min(100, Math.round((storageUsage / storageQuota) * 100)) : 0
  const apiReady = youtubeDataApiConfigured()
  const signInReady = googleSignInConfigured()

  const restoreMixDefaults = () => {
    haptic(8)
    applyTransitionSettings({
      preset: 'auto',
      bars: 16,
      volumeCurve: 'smooth',
      eqCurve: 'center',
      filterCurve: 'none',
      autoMix: false,
      snapToBeat: true,
    })
    pushToast({ kind: 'success', message: 'Transizione riportata ai valori predefiniti.' })
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Impostazioni"
      subtitle="Preferenze locali, spazio e sorgenti"
    >
      <section className="settings-section">
        <header className="settings-heading">
          <Sparkles size={16} />
          <h3>Mixer</h3>
        </header>
        <RangeField
          label="Volume master"
          value={settings.masterVolume}
          min={0}
          max={1}
          step={0.01}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={setMasterVolume}
          onReset={() => setMasterVolume(0.9)}
        />
        <div className="setting-row">
          <div className="setting-copy">
            <span>Curva crossfader</span>
            <span>Equal power mantiene il livello percepito più uniforme.</span>
          </div>
          <div className="segmented">
            <button
              type="button"
              className={settings.crossfaderCurve === 'equalPower' ? 'is-active' : ''}
              onClick={() => setSettings({ crossfaderCurve: 'equalPower' })}
              aria-pressed={settings.crossfaderCurve === 'equalPower'}
            >
              Equal power
            </button>
            <button
              type="button"
              className={settings.crossfaderCurve === 'linear' ? 'is-active' : ''}
              onClick={() => setSettings({ crossfaderCurve: 'linear' })}
              aria-pressed={settings.crossfaderCurve === 'linear'}
            >
              Lineare
            </button>
          </div>
        </div>
        <Toggle
          label="Feedback aptico"
          description="Piccole vibrazioni su play, preset e import."
          checked={settings.haptics}
          onChange={(checked) => setSettings({ haptics: checked })}
        />
        <Toggle
          label="Riduci movimento"
          description="Meno animazioni e trigger auto mix più reattivo."
          checked={settings.reduceMotion}
          onChange={(checked) => setSettings({ reduceMotion: checked })}
        />
        <button type="button" className="ghost-button" onClick={restoreMixDefaults}>
          <Sparkles size={14} /> Ripristina transizione Auto
        </button>
      </section>

      <section className="settings-section">
        <header className="settings-heading">
          <HardDrive size={16} />
          <h3>Audio locale</h3>
        </header>
        <Toggle
          label="Conserva i file nel browser"
          description="I brani importati restano disponibili offline. Nessun file viene caricato online."
          checked={settings.persistAudioFiles}
          onChange={(checked) => setSettings({ persistAudioFiles: checked })}
        />
        <div className="setting-row">
          <div className="setting-copy">
            <span>Limite cache</span>
            <span>I nuovi import oltre il limite restano solo in memoria.</span>
          </div>
          <label className="select-pill">
            <span className="sr-only">Limite cache audio</span>
            <select
              value={settings.storeCapMb}
              onChange={(event) => setSettings({ storeCapMb: Number(event.target.value) })}
            >
              {CAP_OPTIONS.map((cap) => (
                <option key={cap} value={cap}>
                  {cap} MB
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="storage-card inline-storage">
          <div className="storage-head">
            <span>
              <Database size={14} /> Spazio usato
            </span>
            <span>
              {offlineBytes > 0 ? `${formatFileSize(offlineBytes)} audio` : 'nessun audio'}
            </span>
          </div>
          <div className="storage-track">
            <span style={{ width: `${storagePercent}%` }} />
          </div>
          <p>
            {storageQuota > 0
              ? `${formatFileSize(storageUsage)} su ${formatFileSize(storageQuota)} · ${storagePercent}%`
              : 'Stima dello spazio non disponibile in questo browser.'}
          </p>
          <div className="storage-actions">
            <span className={`persist-pill${storagePersisted ? ' is-on' : ''}`}>
              {storagePersisted ? <CheckCircle2 size={12} /> : <Info size={12} />}
              {storagePersisted ? 'Persistente' : 'Non persistente'}
            </span>
            {!storagePersisted ? (
              <button
                type="button"
                className="ghost-button compact"
                onClick={() => void requestStoragePersistence()}
              >
                Richiedi persistenza
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button small"
              onClick={() => void refreshStorageSummary()}
              aria-label="Aggiorna stima spazio"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <header className="settings-heading">
          <ExternalLink size={16} />
          <h3>YouTube Data API</h3>
        </header>
        <div className="config-list">
          <div className="config-row">
            <span className={`config-dot${apiReady ? ' is-on' : ''}`} aria-hidden="true" />
            <div>
              <strong>Ricerca e playlist pubbliche</strong>
              <span>{apiReady ? 'API key configurata' : 'VITE_YOUTUBE_API_KEY non impostata'}</span>
            </div>
            <span className={`config-status${apiReady ? ' is-on' : ''}`}>
              {apiReady ? 'attiva' : 'opzionale'}
            </span>
          </div>
          <div className="config-row">
            <span className={`config-dot${signInReady ? ' is-on' : ''}`} aria-hidden="true" />
            <div>
              <strong>Playlist del tuo canale</strong>
              <span>
                {signInReady ? 'OAuth configurato' : 'VITE_GOOGLE_CLIENT_ID non impostata'}
              </span>
            </div>
            <span className={`config-status${signInReady ? ' is-on' : ''}`}>
              {signInReady ? 'attivo' : 'opzionale'}
            </span>
          </div>
        </div>
        <p className="settings-note">
          Le chiavi si impostano solo nel file <code>.env</code> in fase di build. Non vengono
          chieste all’utente e non vengono salvate nel browser. I link diretti funzionano anche
          senza Data API.
        </p>
      </section>

      <section className="settings-section">
        <header className="settings-heading">
          <ShieldCheck size={16} />
          <h3>Privacy e limiti</h3>
        </header>
        <ul className="privacy-list">
          <li>
            <CheckCircle2 size={13} /> I file audio locali non lasciano mai il dispositivo.
          </li>
          <li>
            <CheckCircle2 size={13} /> Nessun analytics, nessun account Tandem, nessun upload.
          </li>
          <li>
            <CheckCircle2 size={13} /> YouTube passa esclusivamente dall’IFrame Player API
            ufficiale.
          </li>
          <li>
            <Info size={13} /> Con YouTube non sono disponibili EQ, filtro, BPM, key, waveform o
            beatgrid: solo fade di volume.
          </li>
          <li>
            <Info size={13} /> La sessione locale viene salvata in IndexedDB e può essere rimossa
            dal browser se lo spazio è sotto pressione.
          </li>
        </ul>
      </section>

      <footer className="app-about">
        <span>Tandem DJ · 1.0.0</span>
        <span>React + Web Audio · PWA offline</span>
      </footer>
    </BottomSheet>
  )
}
