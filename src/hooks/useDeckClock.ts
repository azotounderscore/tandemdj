import { useEffect, useState } from 'react'
import { audioEngine } from '../audio/engine'
import { youtubeEngine } from '../audio/youtube-engine'
import type { DeckId, SourceMode } from '../types'

export interface DeckClock {
  position: number
  duration: number
}

/**
 * Reads the transport clock straight from the active audio engine. Keeping the
 * clock outside the global store means the green playhead can redraw at ~30fps
 * without re-rendering the whole mixer.
 */
export function useDeckClock(
  mode: SourceMode,
  deck: DeckId,
  fallbackDuration = 0,
  intervalMs = 33,
): DeckClock {
  const [clock, setClock] = useState<DeckClock>({
    position: 0,
    duration: fallbackDuration,
  })

  useEffect(() => {
    let frame = 0
    let last = 0
    const read = () => {
      const position =
        mode === 'local' ? audioEngine.getPosition(deck) : youtubeEngine.getPosition(deck)
      const engineDuration =
        mode === 'local' ? audioEngine.getDuration(deck) : youtubeEngine.getDuration(deck)
      const duration = engineDuration > 0 ? engineDuration : fallbackDuration
      setClock((previous) => {
        if (
          Math.abs(previous.position - position) < 0.02 &&
          Math.abs(previous.duration - duration) < 0.05
        ) {
          return previous
        }
        return { position, duration }
      })
    }
    const tick = (time: number) => {
      if (time - last >= intervalMs) {
        last = time
        read()
      }
      frame = requestAnimationFrame(tick)
    }
    read()
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [mode, deck, fallbackDuration, intervalMs])

  return clock
}
