// Same-origin proxy for FreeSerp Main.
//
// Why it exists: FreeSerp answers with `access-control-allow-origin: *` sent twice
// (checked 2026-10-02 with curl -D -). Browsers reject a duplicated ACAO header, so a
// direct fetch from any other origin fails with "Failed to fetch" even though the docs
// say the API is CORS-open. The proxy calls the API server-side and returns one header.
//
// It is deliberately not an open proxy: the upstream URL is fixed and only the
// parameters the site uses are forwarded, each with a length cap.

const UPSTREAM = 'https://freeserp.ai/api.php';
const TIMEOUT_MS = 12000;

const ALLOWED = new Map([
  ['q', 200],
  ['ai_startups', 1],
  ['ai_categories', 100],
  ['ai_source', 50],
  ['category', 30],
  ['dr_min', 3],
  ['dr_max', 3],
  ['from_date', 10],
  ['to_date', 10],
  ['sort', 30],
  ['order', 4],
  ['size', 3],
  ['from', 5],
  ['stats', 1],
  ['all', 1],
]);

export function buildUpstreamUrl(searchParams) {
  const out = new URLSearchParams();
  for (const [key, max] of ALLOWED) {
    const value = searchParams.get(key);
    if (value !== null && value !== '') out.set(key, value.slice(0, max));
  }
  out.set('project', 'ai-radar-demo');
  return `${UPSTREAM}?${out}`;
}

function send(res, status, body, cacheSeconds) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    cacheSeconds ? `public, max-age=60, s-maxage=${cacheSeconds}, stale-while-revalidate=600` : 'no-store',
  );
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// Plain Node (req, res) handler: runs as a Vercel function and inside dev-server.mjs.
export async function handleProxy(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  const { searchParams } = new URL(req.url, 'http://localhost');
  const target = buildUpstreamUrl(searchParams);
  try {
    const upstream = await fetch(target, {
      headers: { Accept: 'application/json', 'User-Agent': 'ai-radar-demo (+https://github.com/LeonidShamarin/ai-radar)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await upstream.text();
    // Cache only successful answers; errors should be retried, not pinned at the edge.
    return send(res, upstream.status, text, upstream.ok ? 300 : 0);
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError';
    return send(res, timedOut ? 504 : 502, { ok: false, error: timedOut ? 'upstream_timeout' : 'upstream_unreachable' });
  }
}
