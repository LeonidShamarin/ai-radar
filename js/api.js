// FreeSerp Main client (index=sites): https://freeserp.ai/docs.php
//
// Requests go to our own /api/freeserp proxy first: FreeSerp sends its CORS header twice and
// browsers reject that (details in lib/proxy.js). On a static host without the proxy (404) the
// client falls back once to calling FreeSerp directly, which works as soon as they fix CORS.

import { normalizeDomain } from './util.js';

const ENDPOINTS = ['api/freeserp', 'https://freeserp.ai/api.php'];
let endpointIndex = 0;
const TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3; // proxy, one retry, one fallback switch; never more
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 150;

// The docs ask clients to identify themselves; unknown params are ignored by the search.
const IDENTITY = { project: 'ai-radar-demo' };

const memoryCache = new Map();

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function paramString(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...IDENTITY })) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  p.sort(); // stable cache key regardless of param order
  return p.toString();
}

function readCache(key) {
  const hit = memoryCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  try {
    const raw = sessionStorage.getItem(`fs:${key}`);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Date.now() - saved.at < CACHE_TTL_MS) {
        memoryCache.set(key, saved);
        return saved.data;
      }
    }
  } catch {
    // storage blocked or full: cache is an optimisation only
  }
  return null;
}

function writeCache(key, data) {
  const entry = { at: Date.now(), data };
  memoryCache.set(key, entry);
  if (memoryCache.size > CACHE_MAX_ENTRIES) {
    memoryCache.delete(memoryCache.keys().next().value);
  }
  try {
    sessionStorage.setItem(`fs:${key}`, JSON.stringify(entry));
  } catch {
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  }
}

async function fetchOnce(url, signal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: timeout.signal, headers: { Accept: 'application/json' } });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || !body || body.ok === false) {
      const detail = body?.error || res.statusText || 'unknown error';
      throw new ApiError(`FreeSerp ${res.status}: ${detail}`, res.status);
    }
    return body;
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Superseded', 'AbortError');
    if (err.name === 'AbortError') throw new ApiError('FreeSerp не відповів за 15 секунд', 0);
    if (err instanceof ApiError) throw err;
    throw new ApiError('Немає зʼєднання з FreeSerp', 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function query(params, { signal } = {}) {
  const key = paramString(params);
  const cached = readCache(key);
  if (cached) return cached;

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const data = await fetchOnce(`${ENDPOINTS[endpointIndex]}?${key}`, signal);
      writeCache(key, data);
      return data;
    } catch (err) {
      lastError = err;
      if (signal?.aborted || attempt === MAX_ATTEMPTS) break;
      const noProxy = err instanceof ApiError && (err.status === 404 || err.status === 405);
      if (noProxy && endpointIndex < ENDPOINTS.length - 1) {
        endpointIndex += 1;
        continue;
      }
      const retryable = err instanceof ApiError && (err.status === 0 || err.status >= 500);
      if (!retryable) break;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw lastError;
}

export function getStats(opts) {
  return query({ stats: 1 }, opts);
}

// The API has no working exact-domain filter (`domain=` is ignored), so we search by the domain
// text and accept only an exact match. Returns null when the site is not in the index.
export async function getSite(domainInput, opts) {
  const domain = normalizeDomain(domainInput);
  if (!domain) return null;
  const data = await query({ q: domain, size: 10 }, opts);
  return (data.results || []).find((r) => r.domain === domain) || null;
}
