import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  safeUrl,
  normalizeDomain,
  formatDr,
  formatDate,
  shiftDate,
  parseCatalogState,
  catalogQuery,
  toApiParams,
  pageCount,
  bestIndex,
  parseCompareList,
} from '../js/util.js';

test('esc neutralises HTML from scraped titles', () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(esc("it's & co"), 'it&#39;s &amp; co');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

test('safeUrl allows only http(s)', () => {
  assert.equal(safeUrl('https://example.ai'), 'https://example.ai/');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,hi'), null);
  assert.equal(safeUrl('not a url'), null);
  assert.equal(safeUrl(undefined), null);
});

test('normalizeDomain strips scheme, www, path; rejects junk', () => {
  assert.equal(normalizeDomain('https://www.Socixis.dev/pricing?x=1'), 'socixis.dev');
  assert.equal(normalizeDomain('  example.co.uk. '), 'example.co.uk');
  assert.equal(normalizeDomain('localhost'), null);
  assert.equal(normalizeDomain('<script>.com'), null);
  assert.equal(normalizeDomain(''), null);
});

test('formatters show н/д instead of fake zeros', () => {
  assert.equal(formatDr(null), 'н/д');
  assert.equal(formatDr(0), '0');
  assert.equal(formatDr(41), '41');
  assert.equal(formatDate('2026-09-08'), '8 вер 2026');
  assert.equal(formatDate('2026-07-12T03:05:37Z'), '12 лип 2026');
  assert.equal(formatDate('garbage'), 'н/д');
  assert.equal(formatDate(null), 'н/д');
});

test('shiftDate crosses month boundaries in UTC', () => {
  assert.equal(shiftDate('2026-09-08', -7), '2026-09-01');
  assert.equal(shiftDate('2026-09-08', -30), '2026-08-09');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDate('nope', -1), null);
});

test('parseCatalogState clamps hostile input', () => {
  const s = parseCatalogState('dr=999&page=-3&since=365&sort=evil&all=yes');
  assert.equal(s.dr, '');
  assert.equal(s.page, 1);
  assert.equal(s.since, '');
  assert.equal(s.sort, 'went_live');
  assert.equal(s.all, '');
  assert.equal(parseCatalogState('page=401').page, 1);
});

test('default sort depends on q, and round-trips through the URL', () => {
  assert.equal(parseCatalogState('q=voice').sort, 'relevance');
  assert.equal(parseCatalogState('').sort, 'went_live');
  // user explicitly picks "newest first" while searching: must survive the round trip
  const withQ = { ...parseCatalogState('q=voice'), sort: 'went_live' };
  assert.equal(parseCatalogState(catalogQuery(withQ)).sort, 'went_live');
  const s = parseCatalogState('q=image&niche=Image%20Generation&dr=20&since=7&sort=dr&page=3');
  assert.deepEqual(parseCatalogState(catalogQuery(s)), s);
  assert.equal(catalogQuery(parseCatalogState('')), '');
});

test('toApiParams maps UI state to FreeSerp params', () => {
  const s = parseCatalogState('q=agent&niche=Code%20%26%20Dev%20Tools&dr=30&builder=lovable&since=7&page=2');
  assert.deepEqual(toApiParams(s, '2026-09-08'), {
    size: 24,
    from: 24,
    ai_startups: 1,
    q: 'agent',
    ai_categories: 'Code & Dev Tools',
    dr_min: '30',
    ai_source: 'lovable',
    from_date: '2026-09-01',
  });
  const plain = toApiParams(parseCatalogState(''), '2026-09-08');
  assert.equal(plain.sort, 'went_live');
  assert.equal(plain.order, 'desc');
  assert.equal(plain.from_date, undefined);
  const noise = toApiParams(parseCatalogState('all=1&sort=domain'), null);
  assert.equal(noise.ai_startups, undefined);
  assert.equal(noise.category, 'ai');
  assert.equal(noise.order, 'asc');
});

test('pageCount respects the 10 000 offset cap', () => {
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(25), 2);
  assert.equal(pageCount(33570), Math.ceil(10000 / 24));
});

test('bestIndex skips missing values and refuses ties', () => {
  assert.equal(bestIndex([10, null, 41, 3], 'max'), 2);
  assert.equal(bestIndex([null, null], 'max'), -1);
  assert.equal(bestIndex([41, 41, 2], 'max'), -1);
  assert.equal(bestIndex([5, 2, 9], 'min'), 1);
});

test('parseCompareList dedupes, validates, caps at 4', () => {
  assert.deepEqual(parseCompareList('a.ai,A.ai,bad,b.com,c.io,d.dev,e.net'), ['a.ai', 'b.com', 'c.io', 'd.dev']);
  assert.deepEqual(parseCompareList(''), []);
});

test('isAdult catches NSFW generators without hitting normal words', async () => {
  const { isAdult } = await import('../js/util.js');
  assert.equal(isAdult({ domain: 'undressaitool.ai', title: 'x' }), true);
  assert.equal(isAdult({ domain: 'example.ai', title: 'Free NSFW image generator' }), true);
  assert.equal(isAdult({ domain: 'example.ai', ai_summary: 'generates realistic nude images' }), true);
  assert.equal(isAdult({ domain: 'essex-ai.co.uk', title: 'AI consulting in Essex' }), false);
  assert.equal(isAdult({ domain: 'socixis.dev', title: 'AI Marketing Co-Founder' }), false);
  assert.equal(isAdult(null), false);
});
