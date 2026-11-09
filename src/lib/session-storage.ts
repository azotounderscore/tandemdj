import type { DeckId } from '../types'

export interface PersistedSession {
  currentDeck: DeckId
  nextDeck: DeckId
  trackIds: Record<DeckId, string | null>
  queue: string[]
}

const KEY = 'tandem.local-session.v1'

export function saveLocalSession(session: PersistedSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    // The locale remains available even when browser storage is blocked.
  }
}

export function loadPersistedLocalSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<PersistedSession>
    const trackIds = candidate.trackIds
    if (
      (candidate.currentDeck !== 'A' && candidate.currentDeck !== 'B') ||
      (candidate.nextDeck !== 'A' && candidate.nextDeck !== 'B') ||
      !trackIds ||
      typeof trackIds !== 'object'
    ) {
      return null
    }
    return {
      currentDeck: candidate.currentDeck,
      nextDeck: candidate.nextDeck,
      trackIds: {
        A: typeof trackIds.A === 'string' ? trackIds.A : null,
        B: typeof trackIds.B === 'string' ? trackIds.B : null,
      },
      queue: Array.isArray(candidate.queue)
        ? candidate.queue.filter((id): id is string => typeof id === 'string')
        : [],
    }
  } catch {
    return null
  }
}

export function clearPersistedLocalSession(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Ignore inaccessible storage.
  }
}
