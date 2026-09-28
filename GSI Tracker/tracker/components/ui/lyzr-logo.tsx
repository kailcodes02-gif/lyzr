// Lyzr brand marks — fixed artwork from the brand guidelines master files.
// The sail is three planes; never redrawn, recolored off-palette, or distorted.

export function LyzrSail({ className, color = '#FE4B1E' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="2.4 0 52.6 34" className={className} aria-hidden="true" focusable="false">
      <path fill={color} d="M55 21L47.6267 34H2.89478L55 21Z" />
      <path fill={color} d="M43.9352 9.21432L40.3648 20.8969L2.44928 31.9337L43.9352 9.21432Z" />
      <path fill={color} d="M34.1098 10.6493L34.0641 5.80164e-05C33.0913 5.51002 29.7951 9.74939 20.8644 18.5746L34.1098 10.6493Z" />
    </svg>
  )
}
