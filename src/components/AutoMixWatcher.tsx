import { useEffect } from 'react'
import { tickAutoMix } from '../state/controller'

/** Drives auto-mix checks independently of the transient playhead render. */
export function AutoMixWatcher() {
  useEffect(() => {
    const timer = window.setInterval(() => tickAutoMix(), 320)
    return () => window.clearInterval(timer)
  }, [])
  return null
}
