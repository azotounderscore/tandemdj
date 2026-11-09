interface BrandMarkProps {
  size?: number
  className?: string
}

/**
 * Original Tandem DJ mark: two decks and the crossfade line that joins them.
 * Deliberately geometric so it reads at 20px and at 512px.
 */
export function BrandMark({ size = 32, className = '' }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="12" fill="#101214" />
      <rect x="0.5" y="0.5" width="47" height="47" rx="11.5" stroke="#ffffff" strokeOpacity="0.1" />
      <rect x="12" y="13" width="5.5" height="22" rx="2.75" fill="#4DA3FF" />
      <rect x="30.5" y="13" width="5.5" height="22" rx="2.75" fill="#F3A63B" />
      <path
        d="M13 33.5C20.5 33.5 22 14.5 30.8 14.5"
        stroke="#C8FF4D"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M13 14.5C20.5 14.5 22 33.5 30.8 33.5"
        stroke="#F5F1E8"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeOpacity="0.9"
      />
      <circle cx="34.2" cy="14.5" r="2.4" fill="#C8FF4D" />
    </svg>
  )
}
