// Sign-in while embedded in another site's iframe.
//
// Microsoft's sign-in page refuses to load inside an iframe, and the iframe
// cannot keep this origin's cookies, so a framed tracker signs in through a
// pop-up: the pop-up is a normal top-level tab on this origin, runs the usual
// OAuth redirect flow, then hands the session back to the iframe with
// postMessage (same origin on both ends) and closes itself.

export type EmbedAuthMessage =
  | { type: 'gsi-auth'; access_token: string; refresh_token: string }
  | { type: 'gsi-auth-error'; error: string }

// Marks this tab as a sign-in pop-up; sessionStorage survives the round trip
// through Microsoft and Supabase because it is per-tab and per-origin.
const POPUP_FLAG = 'gsi:signin-popup'

export function markAsSignInPopup() {
  try { window.sessionStorage.setItem(POPUP_FLAG, '1') } catch { /* flag lost: falls back to a normal sign-in */ }
}

// The opener to report to, if this tab is a sign-in pop-up that still has one.
export function signInPopupOpener(): Window | null {
  try {
    if (window.sessionStorage.getItem(POPUP_FLAG) !== '1') return null
  } catch { return null }
  return window.opener && !window.opener.closed ? (window.opener as Window) : null
}

export function reportToOpener(opener: Window, msg: EmbedAuthMessage) {
  try { window.sessionStorage.removeItem(POPUP_FLAG) } catch { /* nothing to clear */ }
  opener.postMessage(msg, window.location.origin)
}

// After handing the session to the iframe the pop-up must drop its own copy:
// two holders of one refresh token trip Supabase's reuse detection and both
// get logged out. This deletes the cookies only. supabase.auth.signOut() is
// NOT usable here — even with scope 'local' it calls the server's logout and
// revokes the very session the iframe just received.
export function forgetLocalSession() {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0].trim()
    if (/^sb-.+-auth-token/.test(name)) document.cookie = `${name}=; Max-Age=0; path=/`
  }
}

export function openSignInPopup(provider: string): Window | null {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || ''
  const w = 520, h = 680
  const left = Math.max(0, (window.screenX || 0) + (window.outerWidth - w) / 2)
  const top = Math.max(0, (window.screenY || 0) + (window.outerHeight - h) / 2)
  return window.open(
    `${window.location.origin}${base}/login/?popup=${encodeURIComponent(provider)}`,
    'gsi-signin',
    `popup=yes,width=${w},height=${h},left=${left},top=${top}`
  )
}

export function isEmbedAuthMessage(e: MessageEvent): e is MessageEvent<EmbedAuthMessage> {
  const d = e.data as { type?: unknown } | null
  return e.origin === window.location.origin && !!d && (d.type === 'gsi-auth' || d.type === 'gsi-auth-error')
}
