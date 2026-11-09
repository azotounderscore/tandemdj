import { useMixerStore } from '../state/store'

/** Subtle tactile feedback for performance actions, when supported and enabled. */
export function haptic(pattern: number | number[] = 8): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  if (!useMixerStore.getState().settings.haptics) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Vibration is decorative; failing is harmless.
  }
}
