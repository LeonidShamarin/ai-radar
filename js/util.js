// Pure helpers: no DOM, no network. Covered by tests/util.test.mjs.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Everything that comes from the API was scraped from third-party sites, so it is
// escaped before it ever reaches innerHTML.
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Only http(s) links are rendered; anything else (javascript:, data:) becomes null.
export function safeUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// Accepts "https://www.Example.com/path" and returns "example.com"; null if not a domain.
export function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '').replace(/\.$/, '');
  return DOMAIN_RE.test(s) ? s : null;
}

export function formatDr(dr) {
  return typeof dr === 'number' && Number.isFinite(dr) ? String(dr) : 'н/д';
}

const MONTHS = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв', 'лип', 'серп', 'вер', 'жовт', 'лист', 'груд'];

export function formatDate(iso) {
  if (typeof iso !== 'string') return 'н/д';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 'н/д';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : 'н/д';
}

export function formatNumber(n) {
  return typeof n === 'number' ? n.toLocaleString('uk-UA') : 'н/д';
}

// YYYY-MM-DD shifted by `days` (negative = back). UTC so the result does not depend on the
// visitor's timezone.
export function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Catalog filters live in the hash query so any selection can be shared as a link.
export const CATALOG_DEFAULTS = Object.freeze({
  q: '',
  niche: '',
  dr: '',
  builder: '',
  since: '',
  sort: 'went_live',
  page: 1,
  all: '',
  adult: '',
});

const SORTS = new Set(['relevance', 'went_live', 'dr', 'domain']);
const SINCE = new Set(['', '7', '14', '30']);

export function parseCatalogState(query) {
  const p = new URLSearchParams(query || '');
  const state = { ...CATALOG_DEFAULTS };
  state.q = (p.get('q') || '').slice(0, 200);
  state.niche = (p.get('niche') || '').slice(0, 100);
  state.builder = (p.get('builder') || '').slice(0, 50);
  const dr = Number(p.get('dr'));
  state.dr = Number.isInteger(dr) && dr > 0 && dr <= 100 ? String(dr) : '';
  state.since = SINCE.has(p.get('since') || '') ? p.get('since') || '' : '';
  state.sort = SORTS.has(p.get('sort')) ? p.get('sort') : state.q ? 'relevance' : 'went_live';
  const page = Number(p.get('page'));
  state.page = Number.isInteger(page) && page >= 1 && page <= 400 ? page : 1;
  state.all = p.get('all') === '1' ? '1' : '';
  state.adult = p.get('adult') === '1' ? '1' : '';
  return state;
}

export function catalogQuery(state) {
  const p = new URLSearchParams();
  // The default sort depends on whether there is a text query, see parseCatalogState.
  const defaults = { ...CATALOG_DEFAULTS, sort: state.q ? 'relevance' : 'went_live' };
  for (const [key, def] of Object.entries(defaults)) {
    const value = state[key];
    if (value === undefined || value === '' || value === def) continue;
    p.set(key, String(value));
  }
  return p.toString();
}

export const PAGE_SIZE = 24;

// The index has no adult-content flag, and AI image niches are full of "undress" generators.
// Hidden by default on the client; the visitor can opt in.
const ADULT_TEXT = /\b(nsfw|porn\w*|nude|nudes|nudity|nudify\w*|undress\w*|xxx|hentai|erotic\w*|onlyfans|sexting|deepnude|sex(y|ual)? (chat|ai|images?|videos?))\b|\b18\+/i;
const ADULT_DOMAIN = /(porn|nude|nudify|undress|xxx|hentai|nsfw|onlyfans)/i;

export function isAdult(site) {
  if (!site) return false;
  if (ADULT_DOMAIN.test(site.domain || '')) return true;
  return ADULT_TEXT.test(`${site.title || ''} ${site.ai_summary || ''}`);
}

// Translates UI state into FreeSerp Main query params. `latestDate` is the newest went_live
// in the index: the AI index lags behind real time, so "last 7 days" is counted from it.
export function toApiParams(state, latestDate) {
  const params = { size: PAGE_SIZE, from: (state.page - 1) * PAGE_SIZE };
  if (state.all !== '1') params.ai_startups = 1;
  else params.category = 'ai';
  if (state.q) params.q = state.q;
  if (state.niche) params.ai_categories = state.niche;
  if (state.dr) params.dr_min = state.dr;
  if (state.builder) params.ai_source = state.builder;
  if (state.since && latestDate) params.from_date = shiftDate(latestDate, -Number(state.since));
  if (state.sort === 'domain') {
    params.sort = 'domain';
    params.order = 'asc';
  } else if (state.sort !== 'relevance') {
    params.sort = state.sort;
    params.order = 'desc';
  }
  return params;
}

// API caps from+size at 10 000 for the sites index.
export function pageCount(total) {
  const reachable = Math.min(Number(total) || 0, 10000);
  return Math.max(1, Math.ceil(reachable / PAGE_SIZE));
}

// For the compare table: index of the best value in a row, or -1 when there is no single winner.
export function bestIndex(values, mode) {
  let best = -1;
  let bestValue = null;
  let tie = false;
  values.forEach((v, i) => {
    if (v === null || v === undefined || v === '') return;
    if (bestValue === null) {
      best = i;
      bestValue = v;
      return;
    }
    const better = mode === 'max' ? v > bestValue : v < bestValue;
    if (better) {
      best = i;
      bestValue = v;
      tie = false;
    } else if (v === bestValue) {
      tie = true;
    }
  });
  return tie ? -1 : best;
}

export const MAX_COMPARE = 4;

export function parseCompareList(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const d = normalizeDomain(part);
    if (d && !out.includes(d)) out.push(d);
    if (out.length >= MAX_COMPARE) break;
  }
  return out;
}
