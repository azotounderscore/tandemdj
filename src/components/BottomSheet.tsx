import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'default' | 'wide'
}

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'default',
}: BottomSheetProps) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', handleKey)
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 60)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKey)
      window.clearTimeout(focusTimer)
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className={`sheet-backdrop size-${size}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current()
      }}
    >
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="sheet-header">
          <div className="sheet-heading">
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button sheet-close"
            onClick={() => onCloseRef.current()}
            aria-label="Chiudi"
          >
            <X size={20} strokeWidth={2.2} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <footer className="sheet-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  )
}
