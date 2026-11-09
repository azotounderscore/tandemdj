import { useEffect } from 'react'
import { haptic } from '../lib/haptics'
import { applyTransitionSettings, cueDeck, startMix, toggleCurrentPlay } from '../state/controller'
import { activeSession, useMixerStore } from '../state/store'
import type { TransitionPreset } from '../types'

const PRESET_KEYS: Record<string, TransitionPreset> = {
  '1': 'auto',
  '2': 'fade',
  '3': 'rise',
  '4': 'custom',
}

/** Desktop shortcuts. Ignored while a sheet, field or modifier is active. */
export function KeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }
      const snapshot = useMixerStore.getState()
      if (snapshot.panel) return
      const session = activeSession(snapshot)
      if (session.transitionFrom) return

      if (event.code === 'Space') {
        event.preventDefault()
        void toggleCurrentPlay()
        return
      }
      switch (event.key.toLowerCase()) {
        case 'm':
          event.preventDefault()
          haptic([4, 18, 6])
          void startMix()
          break
        case 'c':
          event.preventDefault()
          cueDeck(session.currentDeck)
          break
        case 'l':
          event.preventDefault()
          snapshot.setPanel('library')
          break
        case 'y':
          event.preventDefault()
          if (snapshot.mode === 'youtube') snapshot.setPanel('youtube')
          break
        default: {
          const preset = PRESET_KEYS[event.key]
          if (preset) {
            event.preventDefault()
            haptic(5)
            applyTransitionSettings({ preset })
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return null
}
