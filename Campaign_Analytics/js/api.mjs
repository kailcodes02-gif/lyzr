// Thin JSON client for /api/ca/*. Attaches the Microsoft bearer token.
// The heavy GETs are served from a shared server-side cache (8 hours, same for every user).
// refreshNext() makes the GETs of the next REFRESH_WINDOW_MS carry `x-ca-refresh: 1`, which
// bypasses and rewrites that cache for everyone (the top-bar Refresh data button calls it).
// lastCachedAt holds the `x-ca-cached-at` stamp of the last response that carried one.
export class ApiError extends Error { constructor(status, message, body) { super(message); this.status = status; this.body = body; } }
export const REFRESH_WINDOW_MS = 90 * 1000;

export function createApi(getToken, base = '/api/ca') {
  let refreshUntil = 0;
  const api = {
    get: (p, params) => call('GET', p, { params }),
    post: (p, body) => call('POST', p, { body }),
    put: (p, body) => call('PUT', p, { body }),
    del: (p, params) => call('DELETE', p, { params }),
    refreshNext: () => { refreshUntil = Date.now() + REFRESH_WINDOW_MS; },
    lastCachedAt: null,
    isDemo: false,
  };
  async function call(method, path, { params, body } = {}) {
    const url = new URL(base + '/' + path.replace(/^\//, ''), location.origin);
    if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    const token = await getToken();
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method === 'GET' && Date.now() < refreshUntil) headers['x-ca-refresh'] = '1';
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    const cachedAt = res.headers && res.headers.get('x-ca-cached-at');
    if (cachedAt) api.lastCachedAt = cachedAt;
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 300) }; }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || `HTTP ${res.status}`, data);
    return data;
  }
  return api;
}
