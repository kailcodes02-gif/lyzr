import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    // Initial read also goes through a 0ms timeout rather than a synchronous
    // setState call in the effect body.
    const initial = setTimeout(onChange, 0)
    return () => {
      mql.removeEventListener("change", onChange)
      clearTimeout(initial)
    }
  }, [])

  return !!isMobile
}
