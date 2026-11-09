import { useEffect } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { useMixerStore } from '../state/store'

/** Registers the service worker and surfaces a deliberate update prompt. */
export function PwaManager() {
  useEffect(() => {
    let prompted = false
    let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        if (prompted) return
        prompted = true
        useMixerStore.getState().pushToast({
          kind: 'info',
          message: 'Nuova versione di Tandem DJ disponibile.',
          actionLabel: 'Aggiorna',
          duration: 0,
          action: () => {
            void updateSW?.(true)
          },
        })
      },
      onOfflineReady() {
        useMixerStore.getState().pushToast({
          kind: 'success',
          message: 'App pronta offline. Libreria e cache locale disponibili senza rete.',
        })
      },
      onRegisterError(error) {
        console.warn('[pwa] registrazione non riuscita', error)
      },
    })
    return () => {
      // The registration itself is intentionally left active for the PWA.
    }
  }, [])

  return null
}
