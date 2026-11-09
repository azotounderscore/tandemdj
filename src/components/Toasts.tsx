import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { ToastMessage } from '../types'
import { useMixerStore } from '../state/store'

function ToastIcon({ kind }: { kind: ToastMessage['kind'] }) {
  if (kind === 'success') return <CheckCircle2 size={18} />
  if (kind === 'warning') return <AlertTriangle size={18} />
  if (kind === 'error') return <XCircle size={18} />
  return <Info size={18} />
}

export function Toasts() {
  const toasts = useMixerStore((state) => state.toasts)
  const removeToast = useMixerStore((state) => state.removeToast)

  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
          <span className="toast-icon">
            <ToastIcon kind={toast.kind} />
          </span>
          <p className="toast-message">{toast.message}</p>
          {toast.action && toast.actionLabel ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.()
                removeToast(toast.id)
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="toast-close"
            onClick={() => removeToast(toast.id)}
            aria-label="Chiudi notifica"
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
