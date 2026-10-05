// Keep pages as they are between tab switches. Two layers, both in memory for this browser tab:
//   1. withGetCache(api): every GET answer is kept for TTL (8 hours) per path + params, so going back
//      to a page never refetches. Writes (uploads, pulls, actions, settings) drop the GETs they can change.
//   2. The router keeps one rendered page per route (app.mjs): switching tabs shows it again untouched.
// The "Refresh data" button in the top bar clears both and redraws the page from the server; it also
// opens the api's refresh window (api.refreshNext) so the server's shared 8-hour cache is bypassed
// and rewritten for every user.
// Claude is never called by either layer: AI read-outs only run on their own Generate button.
export const TTL_MS = 8 * 60 * 60 * 1000;

// Which cached GET paths a write can change. A write to a path not listed here clears everything.
const WRITES = {
  actions: ['actions', 'coverage'],
  insights: ['insights'],
  settings: null,
};
let stamp = Date.now();
export const cachedSince = () => stamp;

export function withGetCache(api) {
  const cache = new Map(); // key -> { at, promise }
  const keyOf = (p, params) => String(p).replace(/^\//, '') + '?' + JSON.stringify(params || {});
  const clear = paths => { if (!paths) { cache.clear(); return; } for (const k of [...cache.keys()]) if (paths.some(p => k.startsWith(p + '?'))) cache.delete(k); };
  const afterWrite = p => { const root = String(p).replace(/^\//, '').split('/')[0]; clear(Object.prototype.hasOwnProperty.call(WRITES, root) ? WRITES[root] : null); };
  const get = (p, params) => {
    const k = keyOf(p, params), hit = cache.get(k);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
    const promise = api.get(p, params);
    cache.set(k, { at: Date.now(), promise });
    promise.catch(() => { if (cache.get(k) && cache.get(k).promise === promise) cache.delete(k); });
    return promise;
  };
  const wrap = fn => async (p, body) => { try { return await fn(p, body); } finally { afterWrite(p); } };
  return {
    ...api,
    get,
    post: wrap(api.post), put: wrap(api.put), del: wrap(api.del),
    // The server stamp lives on the inner api (set per response), so forward it instead of copying it once.
    get lastCachedAt() { return api.lastCachedAt || null; },
    clearCache: () => { cache.clear(); stamp = Date.now(); api.lastCachedAt = null; if (typeof api.refreshNext === 'function') api.refreshNext(); },
  };
}
