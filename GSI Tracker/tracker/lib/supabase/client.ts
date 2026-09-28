import { createBrowserClient } from '@supabase/ssr'
import { createClient as createJsClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const browserClient = () => createBrowserClient(URL, KEY)
type Client = ReturnType<typeof browserClient>

// True when the tracker runs inside another site's iframe (e.g. the
// www.lyzr.ai/marketing-tracker embed).
export function isFramed() {
  if (typeof window === 'undefined') return false
  try { return window.self !== window.top } catch { return true }
}

// Inside a cross-site iframe the browser drops or blocks this origin's
// cookies (they are third-party there), so the cookie-based client cannot
// hold a session. Framed, the session lives in the iframe's own (partitioned)
// localStorage instead; memory is the last resort when storage is blocked.
const memory = new Map<string, string>()
const frameStorage = {
  getItem: (k: string) => { try { return window.localStorage.getItem(k) } catch { return memory.get(k) ?? null } },
  setItem: (k: string, v: string) => { try { window.localStorage.setItem(k, v) } catch { memory.set(k, v) } },
  removeItem: (k: string) => { try { window.localStorage.removeItem(k) } catch { memory.delete(k) } },
}

let framedClient: Client | null = null

export function createClient() {
  if (isFramed()) {
    framedClient ??= createJsClient(URL, KEY, {
      auth: {
        storage: frameStorage,
        storageKey: 'gsi-embed-auth',
        persistSession: true,
        autoRefreshToken: true,
        // The session arrives from the sign-in pop-up, never via the URL.
        detectSessionInUrl: false,
      },
    }) as unknown as Client
    return framedClient
  }
  return browserClient()
}
