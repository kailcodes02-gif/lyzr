/**
 * Cloudflare Worker — Work OS Auth Handler
 *
 * DEPLOY: Paste this entire file into the Cloudflare Workers dashboard.
 * Set environment variables in the Worker settings:
 *   USERNAME = your admin username
 *   PASSWORD = your admin password
 *
 * Routes handled:
 *   POST /auth/login    — validate credentials, set session cookie
 *   GET  /auth/logout   — clear session cookie, redirect to /
 *   GET  /auth/verify   — check if session cookie is valid
 *   GET  /control/*     — middleware: protect with auth check
 *   All others          — pass through to Cloudflare Pages origin
 */

const SESSION_COOKIE = 'wos_session';
const COOKIE_MAX_AGE = 86400; // 24 hours

/**
 * Generate a secure random session token.
 */
function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse cookies from a Cookie header string.
 * Returns an object of { name: value }.
 */
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [name, ...rest] = c.trim().split('=');
      return [name.trim(), rest.join('=').trim()];
    })
  );
}

/**
 * Build a Set-Cookie header value.
 */
function buildCookieHeader(name, value, maxAge) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/**
 * Active sessions store.
 * NOTE: In-memory; resets on Worker restart.
 * Phase 5: Replace with KV store for persistence.
 */
const activeSessions = new Set();

export default {
  async fetch(request, env) {
    const url     = new URL(request.url);
    const path    = url.pathname;
    const method  = request.method;
    const cookies = parseCookies(request.headers.get('Cookie'));

    // ── POST /auth/login ───────────────────────────────────────────────────
    if (path === '/auth/login' && method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return new Response(JSON.stringify({ success: false }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const { username, password } = body;

      if (username === env.USERNAME && password === env.PASSWORD) {
        const token = generateToken();
        activeSessions.add(token);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': buildCookieHeader(SESSION_COOKIE, token, COOKIE_MAX_AGE)
          }
        });
      } else {
        return new Response(JSON.stringify({ success: false }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // ── GET /auth/logout ───────────────────────────────────────────────────
    if (path === '/auth/logout' && method === 'GET') {
      const sessionToken = cookies[SESSION_COOKIE];
      if (sessionToken) activeSessions.delete(sessionToken);

      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': buildCookieHeader(SESSION_COOKIE, '', 0)
        }
      });
    }

    // ── GET /auth/verify ───────────────────────────────────────────────────
    if (path === '/auth/verify' && method === 'GET') {
      const sessionToken = cookies[SESSION_COOKIE];

      if (sessionToken && activeSessions.has(sessionToken)) {
        return new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify({ authenticated: false }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // ── Middleware: protect /control/* ─────────────────────────────────────
    if (path.startsWith('/control')) {
      const sessionToken = cookies[SESSION_COOKIE];

      if (!sessionToken || !activeSessions.has(sessionToken)) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': '/' }
        });
      }

      // Session is valid — pass through to origin, add security headers
      const response = await fetch(request);
      const newResponse = new Response(response.body, response);
      newResponse.headers.set('X-Robots-Tag', 'noindex, nofollow');
      newResponse.headers.set('X-Frame-Options', 'DENY');
      newResponse.headers.set('Cache-Control', 'no-store');
      return newResponse;
    }

    // ── All other requests: pass through to origin ─────────────────────────
    return fetch(request);
  }
};
