// Sign-in sends you back where you were going. A shared link to someone's
// page (/u/?who=mothilal) opened while signed out lands on the login page; this
// remembers the address for the tab and hands it back after sign-in.
const KEY = 'gsi:return-to'
let memory: string | null = null

export function rememberReturnTo(explicit?: string | null) {
  if (typeof window === 'undefined') return
  const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
  const path = window.location.pathname.startsWith(base) ? window.location.pathname.slice(base.length) || '/' : window.location.pathname
  if (!explicit && (path.startsWith('/login') || path.startsWith('/auth'))) return
  const target = explicit || path + window.location.search
  if (target === '/') return
  memory = target
  try { window.sessionStorage.setItem(KEY, target) } catch { /* memory copy still works for this page load */ }
}

export function takeReturnTo(): string {
  let v = memory
  try { v = window.sessionStorage.getItem(KEY) || v; window.sessionStorage.removeItem(KEY) } catch { /* use memory */ }
  memory = null
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/'
}
