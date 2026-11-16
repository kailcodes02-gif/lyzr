// The tracker's public address.
//
// People reach the tracker at www.lyzr.ai/marketing-tracker/, a BetterLinks
// cloaked link: WordPress serves a bare page with one full-screen iframe on
// this site, and forwards the query string into it. We cannot run a script on
// that page, so links that must open a specific place carry it as a query
// parameter on the public address, and the tracker routes on arrival:
//     ?u=<handle>    someone's page          -> /u/?who=<handle>
//     ?page=<path>   any other tracker page  -> <path>
// Three things on the WordPress side must stay as they are: the slug
// /marketing-tracker/, parameter forwarding on, and the cloaked target
// https://lyzr.kailash-gm.com/GSI_Tracker/.
export const PUBLIC_URL = (process.env.NEXT_PUBLIC_PUBLIC_URL || 'https://www.lyzr.ai/marketing-tracker/').replace(/\/?$/, '/')

export function publicLink(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString()
  return qs ? `${PUBLIC_URL}?${qs}` : PUBLIC_URL
}

// Where a forwarded ?u= / ?page= on the current address should land, or null.
// Only same-app paths are accepted.
export function deepLinkTarget(): string | null {
  if (typeof window === 'undefined') return null
  let qs: URLSearchParams
  try { qs = new URLSearchParams(window.location.search) } catch { return null }
  const u = (qs.get('u') || '').trim()
  if (u) return `/u/?who=${encodeURIComponent(u.toLowerCase())}`
  const page = (qs.get('page') || '').trim()
  if (page && page.startsWith('/') && !page.startsWith('//') && !page.includes('://')) return page
  return null
}
