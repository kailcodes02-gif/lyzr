// Thin JSON client for /api/ca/*. Attaches the Microsoft bearer token.
export class ApiError extends Error { constructor(status, message, body) { super(message); this.status = status; this.body = body; } }

export function createApi(getToken, base = '/api/ca') {
  async function call(method, path, { params, body } = {}) {
    const url = new URL(base + '/' + path.replace(/^\//, ''), location.origin);
    if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    const token = await getToken();
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 300) }; }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || `HTTP ${res.status}`, data);
    return data;
  }
  return {
    get: (p, params) => call('GET', p, { params }),
    post: (p, body) => call('POST', p, { body }),
    put: (p, body) => call('PUT', p, { body }),
    del: (p, params) => call('DELETE', p, { params }),
    isDemo: false,
  };
}
