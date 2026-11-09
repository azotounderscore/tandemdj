import { RotateCcw } from 'lucide-react'
import type { CSSProperties } from 'react'

interface RangeFieldProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (value: number) => string
  onChange: (value: number) => void
  onReset?: () => void
  hint?: string
  disabled?: boolean
  zeroAt?: number
  ariaLabel?: string
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange,
  onReset,
  hint,
  disabled = false,
  zeroAt,
  ariaLabel,
}: RangeFieldProps) {
  const percent = ((value - min) / (max - min)) * 100
  const zeroPercent = zeroAt === undefined ? null : ((zeroAt - min) / (max - min)) * 100

  return (
    <div className={`range-field${disabled ? ' is-disabled' : ''}`}>
      <div className="range-head">
        <span className="range-label">{label}</span>
        <div className="range-value-group">
          <span className="range-value">{format(value)}</span>
          {onReset && !disabled ? (
            <button
              type="button"
              className="range-reset"
              onClick={onReset}
              aria-label={`Reimposta ${label.toLowerCase()}`}
            >
              <RotateCcw size={13} strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="range-track-wrap">
        {zeroPercent !== null ? (
          <span className="range-zero" style={{ left: `${zeroPercent}%` }} aria-hidden="true" />
        ) : null}
        <input
          className="range-input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ '--range-progress': `${percent}%` } as CSSProperties}
        />
      </div>
      {hint ? <p className="range-hint">{hint}</p> : null}
    </div>
  )
}
