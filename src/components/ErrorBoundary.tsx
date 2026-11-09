import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertOctagon, RefreshCw, Trash2 } from 'lucide-react'
import { BrandMark } from './BrandMark'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[tandem] render error', error, info.componentStack)
  }

  private clearPreferences = () => {
    try {
      localStorage.removeItem('tandem.preferences.v1')
    } catch {
      // Storage may be blocked.
    }
    window.location.reload()
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <main className="error-screen">
        <BrandMark size={54} />
        <span className="error-kicker">Tandem DJ</span>
        <h1>Qualcosa si è fermato.</h1>
        <p>
          Il mixer ha incontrato un errore imprevisto. I file audio nella cache IndexedDB non
          vengono toccati.
        </p>
        <pre>{this.state.error.message}</pre>
        <div className="error-actions">
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            <RefreshCw size={16} /> Ricarica l’app
          </button>
          <button type="button" className="ghost-button" onClick={this.clearPreferences}>
            <Trash2 size={15} /> Cancella preferenze e ricarica
          </button>
        </div>
        <div className="error-icon" aria-hidden="true">
          <AlertOctagon size={18} />
        </div>
      </main>
    )
  }
}
