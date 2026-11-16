// Everyone has a personal page: /u/?who=<handle> inside the tracker. The link
// people share is the public lyzr.ai address with ?u=<handle>, which the
// tracker turns back into that page on arrival (see lib/embed.ts).
import type { User } from '@/lib/types/database'
import { publicLink } from '@/lib/embed'

type Person = Pick<User, 'email'> & { handle?: string | null }

// Before migration 038 there is no handle column: fall back to the email name.
export function handleOf(u: Person) {
  return (u.handle || u.email.split('@')[0]).toLowerCase()
}

export function personPath(u: Person) {
  return `/u/?who=${encodeURIComponent(handleOf(u))}`
}

// Find the person a ?who= value points at: handle first, then email name,
// then first name (so a hand-typed link still lands).
export function findPerson<T extends Person>(people: T[], p: string | null | undefined): T | undefined {
  const key = (p || '').trim().toLowerCase()
  if (!key) return undefined
  return people.find(u => (u.handle || '').toLowerCase() === key)
    || people.find(u => u.email.toLowerCase() === key)
    || people.find(u => u.email.split('@')[0].toLowerCase() === key)
    || people.find(u => u.email.split('@')[0].split('.')[0].toLowerCase() === key)
}

// The link to hand to other people: www.lyzr.ai/marketing-tracker/?u=<handle>
export function personUrl(u: Person) {
  return publicLink({ u: handleOf(u) })
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* blocked in some frames: fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}
