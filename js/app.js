import { query, getStats, getSite, ApiError } from './api.js';
import {
  esc,
  safeUrl,
  normalizeDomain,
  formatDr,
  formatDate,
  formatNumber,
  parseCatalogState,
  catalogQuery,
  toApiParams,
  pageCount,
  bestIndex,
  parseCompareList,
  isAdult,
  MAX_COMPARE,
} from './util.js';

const view = document.getElementById('view');
const compareBadge = document.getElementById('compare-count');
const toastEl = document.getElementById('toast');
const REPO_URL = 'https://github.com/LeonidShamarin/ai-radar';

// ---------- shared data ----------

let statsPromise = null;
function loadStats() {
  statsPromise ??= getStats().catch((err) => {
    statsPromise = null;
    throw err;
  });
  return statsPromise;
}

// Newest went_live among AI startups. The index lags behind the calendar, so date filters are
// counted from this date instead of "today".
let latestPromise = null;
function loadLatestDate() {
  latestPromise ??= query({ ai_startups: 1, sort: 'went_live', order: 'desc', size: 12 })
    .then((d) => ({ date: d.results?.[0]?.went_live || null, newest: d.results || [] }))
    .catch((err) => {
      latestPromise = null;
      throw err;
    });
  return latestPromise;
}

const NOISE_NICHES = new Set(['Other AI']);
function nicheOptions(stats) {
  return (stats?.top_ai_categories || []).filter((c) => c.key && !NOISE_NICHES.has(c.key));
}

// ai_source mixes builders with generator meta tags ("gen:..."); keep only the builders.
function builderOptions(stats) {
  return (stats?.top_ai_source || [])
    .filter((s) => s.key && !s.key.startsWith('gen:') && s.key !== 'not_ai')
    .slice(0, 12);
}

const BUILDER_LABELS = {
  ai_likely: 'AI-генерація',
  not_ai: 'Класичний',
  lovable: 'Lovable',
  v0: 'v0',
  bolt: 'Bolt',
  base44: 'Base44',
  nextjs: 'Next.js',
  wordpress: 'WordPress',
  shopify: 'Shopify',
  wix: 'Wix',
  webflow: 'Webflow',
  react: 'React',
  elementor: 'Elementor',
  joomla: 'Joomla',
};
// ai_source can also be a raw generator meta tag ("gen:wpml ver4.9.6 ..."): not useful to show.
const builderLabel = (key) => BUILDER_LABELS[key] || (key.startsWith('gen:') ? 'Інший' : key);
const safeOnly = (sites) => (sites || []).filter((s) => !isAdult(s));

// ---------- compare list (per-visitor, localStorage) ----------

const COMPARE_KEY = 'ai-radar-compare';
function getCompare() {
  try {
    return parseCompareList(JSON.parse(localStorage.getItem(COMPARE_KEY) || '[]').join(','));
  } catch {
    return [];
  }
}
function setCompare(list) {
  try {
    localStorage.setItem(COMPARE_KEY, JSON.stringify(list));
  } catch {
    // private mode: the list still works through the URL
  }
  renderCompareBadge();
}
function renderCompareBadge() {
  const n = getCompare().length;
  compareBadge.textContent = n ? String(n) : '';
  compareBadge.hidden = n === 0;
}
function toggleCompare(domain) {
  const list = getCompare();
  if (list.includes(domain)) {
    setCompare(list.filter((d) => d !== domain));
    toast(`${domain} прибрано з порівняння`);
  } else if (list.length >= MAX_COMPARE) {
    toast(`У порівнянні вже ${MAX_COMPARE} сайти. Приберіть один, щоб додати новий.`);
  } else {
    setCompare([...list, domain]);
    toast(`${domain} додано до порівняння`);
  }
  document.querySelectorAll(`[data-compare="${CSS.escape(domain)}"]`).forEach(syncCompareButton);
}
function syncCompareButton(btn) {
  const on = getCompare().includes(btn.dataset.compare);
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '✓ У порівнянні' : '+ Порівняти';
}

let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ---------- templates ----------

function favicon(domain) {
  const d = esc(domain);
  return `<img class="fav" src="https://icons.duckduckgo.com/ip3/${d}.ico" alt="" width="32" height="32" loading="lazy" decoding="async" data-letter="${esc(domain.charAt(0).toUpperCase())}">`;
}

function nicheTags(cats, limit = 3) {
  if (!Array.isArray(cats) || !cats.length) return '';
  return `<ul class="tags">${cats
    .slice(0, limit)
    .map((c) => `<li><a href="#/catalog?${esc(catalogQuery({ niche: c }))}">${esc(c)}</a></li>`)
    .join('')}</ul>`;
}

function compareButton(domain) {
  const on = getCompare().includes(domain);
  return `<button type="button" class="btn btn-ghost" data-compare="${esc(domain)}" aria-pressed="${on}">${on ? '✓ У порівнянні' : '+ Порівняти'}</button>`;
}

function card(site) {
  const domain = site.domain || '';
  return `<article class="card">
    <div class="card-head">
      ${favicon(domain)}
      <div class="card-title">
        <h3><a href="#/site/${esc(encodeURIComponent(domain))}">${esc(domain)}</a></h3>
        <p class="muted one-line" title="${esc(site.title)}">${esc(site.title || 'Без заголовка')}</p>
      </div>
    </div>
    <p class="summary">${esc(site.ai_summary || 'Опису ще немає.')}</p>
    ${nicheTags(site.ai_categories)}
    <dl class="meta">
      <div><dt>DR</dt><dd>${esc(formatDr(site.dr))}</dd></div>
      <div><dt>Запуск</dt><dd>${esc(formatDate(site.went_live))}</dd></div>
      <div><dt>Стек</dt><dd>${esc(site.ai_source ? builderLabel(site.ai_source) : 'н/д')}</dd></div>
    </dl>
    <div class="card-actions">
      <a class="btn" href="#/site/${esc(encodeURIComponent(domain))}">Детальніше</a>
      ${compareButton(domain)}
    </div>
  </article>`;
}

function grid(sites) {
  return `<div class="grid">${sites.map(card).join('')}</div>`;
}

function skeleton(n = 6) {
  return `<div class="grid" aria-hidden="true">${'<div class="card skeleton"></div>'.repeat(n)}</div>`;
}

function errorBox(err) {
  const msg = err instanceof ApiError ? err.message : 'Щось пішло не так під час завантаження.';
  return `<div class="notice notice-error" role="alert">
    <p><strong>Не вдалося отримати дані.</strong> ${esc(msg)}</p>
    <button type="button" class="btn" data-action="retry">Спробувати ще раз</button>
  </div>`;
}

// ---------- views ----------

async function renderOverview(signal) {
  view.innerHTML = `
    <section class="hero">
      <h1>Нові AI-продукти, щойно з'явились у мережі</h1>
      <p class="lead">AI Radar показує свіжі AI-стартапи з індексу FreeSerp: опис, авторитет домену, ніша і дата запуску. Відфільтруйте шум, знайдіть свою нішу, порівняйте конкурентів.</p>
      <form class="hero-search" data-form="hero" role="search">
        <label class="sr-only" for="hero-q">Пошук AI-продуктів</label>
        <input id="hero-q" name="q" type="search" placeholder="Наприклад: voice agent, image upscaler, legal AI" autocomplete="off">
        <button class="btn btn-primary" type="submit">Знайти</button>
      </form>
    </section>
    <section aria-labelledby="stats-h"><h2 id="stats-h" class="sr-only">Індекс у цифрах</h2><div id="stats" class="stats">${'<div class="stat skeleton"></div>'.repeat(4)}</div></section>
    <section aria-labelledby="niches-h">
      <div class="section-head"><h2 id="niches-h">Ніші</h2><a href="#/catalog">Увесь каталог →</a></div>
      <div id="niches" class="niches"><p class="muted">Завантаження…</p></div>
    </section>
    <section aria-labelledby="new-h">
      <div class="section-head"><h2 id="new-h">Найновіші</h2><a href="#/catalog?sort=went_live">Усі нові →</a></div>
      <div id="newest">${skeleton(4)}</div>
    </section>
    <section aria-labelledby="top-h">
      <div class="section-head"><h2 id="top-h">Найавторитетніші нові</h2><a href="#/catalog?sort=dr&since=30">Більше →</a></div>
      <p class="muted small">Найвищий Domain Rating серед AI-продуктів, що вперше відповіли за останні 30 днів індексу.</p>
      <div id="top">${skeleton(4)}</div>
    </section>`;

  const statsTask = loadStats().then((s) => {
    if (signal.aborted) return;
    document.getElementById('stats').innerHTML = [
      ['AI-продуктів у каталозі', formatNumber(s.ai_startups?.total)],
      ['Нових сайтів за 7 днів (увесь індекс)', formatNumber(s.new?.last_7d)],
      ['Живих сайтів в індексі', formatNumber(s.totals?.real_sites)],
      ['Середній DR', s.dr?.avg ?? 'н/д'],
    ]
      .map(([label, value]) => `<div class="stat"><span class="stat-value">${esc(value)}</span><span class="stat-label">${esc(label)}</span></div>`)
      .join('');
    document.getElementById('niches').innerHTML = nicheOptions(s)
      .slice(0, 18)
      .map(
        (c) => `<a class="niche" href="#/catalog?${esc(catalogQuery({ niche: c.key }))}"><span>${esc(c.key)}</span><span class="muted">${esc(formatNumber(c.count))}</span></a>`,
      )
      .join('');
  });

  const newestTask = loadLatestDate().then(({ newest }) => {
    if (!signal.aborted) document.getElementById('newest').innerHTML = grid(safeOnly(newest).slice(0, 8));
  });

  const topTask = loadLatestDate()
    .then(({ date }) => query(toApiParams({ ...parseCatalogState('sort=dr&since=30') }, date), { signal }))
    .then((d) => {
      if (!signal.aborted) document.getElementById('top').innerHTML = grid(safeOnly(d.results).slice(0, 8));
    });

  const results = await Promise.allSettled([statsTask, newestTask, topTask]);
  const failed = results.find((r) => r.status === 'rejected' && r.reason?.name !== 'AbortError');
  if (failed && !signal.aborted) {
    view.insertAdjacentHTML('afterbegin', errorBox(failed.reason));
  }
}

function sinceLabel(days) {
  return { 7: 'за 7 днів', 14: 'за 14 днів', 30: 'за 30 днів' }[days] || 'за весь час';
}

async function renderCatalog(signal, queryString) {
  const state = parseCatalogState(queryString);

  if (!document.getElementById('catalog-form')) {
    view.innerHTML = `
      <div class="section-head"><h1>Каталог AI-продуктів</h1></div>
      <form id="catalog-form" class="filters" role="search">
        <div class="field field-wide">
          <label for="f-q">Пошук</label>
          <input id="f-q" name="q" type="search" placeholder="Ключові слова або домен" autocomplete="off">
        </div>
        <div class="field"><label for="f-niche">Ніша</label><select id="f-niche" name="niche"><option value="">Усі ніші</option></select></div>
        <div class="field"><label for="f-builder">Стек / конструктор</label><select id="f-builder" name="builder"><option value="">Будь-який</option></select></div>
        <div class="field"><label for="f-dr">DR від</label>
          <select id="f-dr" name="dr"><option value="">Будь-який</option><option value="10">10+</option><option value="20">20+</option><option value="30">30+</option><option value="50">50+</option></select></div>
        <div class="field"><label for="f-since">Запущені</label>
          <select id="f-since" name="since"><option value="">За весь час</option><option value="7">За 7 днів</option><option value="14">За 14 днів</option><option value="30">За 30 днів</option></select></div>
        <div class="field"><label for="f-sort">Сортування</label>
          <select id="f-sort" name="sort"><option value="went_live">Спершу нові</option><option value="dr">За DR</option><option value="relevance">За релевантністю</option><option value="domain">За доменом (А-Я)</option></select></div>
        <label class="check"><input type="checkbox" name="all" value="1"> Показати весь шум (магазини, каталоги, агентства з AI на сайті)</label>
        <label class="check"><input type="checkbox" name="adult" value="1"> Показувати сайти 18+</label>
        <button type="button" class="btn btn-ghost" data-action="reset">Скинути фільтри</button>
      </form>
      <p id="result-info" class="muted" aria-live="polite"></p>
      <div id="results"></div>
      <nav id="pager" class="pager" aria-label="Сторінки"></nav>`;

    loadStats()
      .then((s) => {
        const niche = document.getElementById('f-niche');
        const builder = document.getElementById('f-builder');
        if (!niche) return;
        niche.insertAdjacentHTML('beforeend', nicheOptions(s).map((c) => `<option value="${esc(c.key)}">${esc(c.key)}</option>`).join(''));
        builder.insertAdjacentHTML('beforeend', builderOptions(s).map((b) => `<option value="${esc(b.key)}">${esc(builderLabel(b.key))}</option>`).join(''));
        syncForm(parseCatalogState(currentRoute().query));
      })
      .catch(() => {
        // filters still work without the dynamic option lists
      });
  }

  syncForm(state);
  const results = document.getElementById('results');
  const info = document.getElementById('result-info');
  const pager = document.getElementById('pager');
  results.innerHTML = skeleton(6);
  info.textContent = 'Шукаю…';
  pager.innerHTML = '';

  try {
    const { date } = await loadLatestDate();
    const data = await query(toApiParams(state, date), { signal });
    if (signal.aborted) return;
    const raw = data.results || [];
    const items = state.adult === '1' ? raw : safeOnly(raw);
    const hidden = raw.length - items.length;
    const total = data.total || 0;
    const pages = pageCount(total);
    const windowNote = state.since && date ? ` Запущені ${sinceLabel(state.since)} до ${formatDate(date)}.` : '';
    const hiddenNote = hidden ? ` На цій сторінці приховано сайтів 18+: ${hidden}.` : '';
    info.textContent = total
      ? `Знайдено ${formatNumber(total)}. Сторінка ${state.page} з ${formatNumber(pages)}.${windowNote}${hiddenNote}`
      : `Нічого не знайдено.${windowNote}`;
    results.innerHTML = items.length
      ? grid(items)
      : `<div class="notice"><p>За цими фільтрами порожньо. Спробуйте прибрати DR чи нішу, або <a href="#/catalog?${esc(catalogQuery({ ...state, all: '1', page: 1 }))}">увімкнути весь шум</a>.</p></div>`;
    if (pages > 1) {
      const link = (page, label, rel) =>
        `<a class="btn" rel="${rel}" href="#/catalog?${esc(catalogQuery({ ...state, page }))}">${label}</a>`;
      pager.innerHTML = `${state.page > 1 ? link(state.page - 1, '← Попередня', 'prev') : ''}
        <span class="muted">${state.page} / ${formatNumber(pages)}</span>
        ${state.page < pages ? link(state.page + 1, 'Наступна →', 'next') : ''}`;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    info.textContent = '';
    results.innerHTML = errorBox(err);
  }
}

function syncForm(state) {
  const form = document.getElementById('catalog-form');
  if (!form) return;
  for (const name of ['q', 'niche', 'builder', 'dr', 'since', 'sort']) {
    const el = form.elements[name];
    if (document.activeElement === el && name === 'q') continue; // don't fight the typist
    if (el.tagName === 'SELECT' && state[name] && ![...el.options].some((o) => o.value === state[name])) {
      el.insertAdjacentHTML('beforeend', `<option value="${esc(state[name])}">${esc(name === 'builder' ? builderLabel(state[name]) : state[name])}</option>`);
    }
    el.value = state[name];
  }
  form.elements.all.checked = state.all === '1';
  form.elements.adult.checked = state.adult === '1';
}

function formState(form) {
  const fd = new FormData(form);
  return parseCatalogState(
    catalogQuery({
      q: (fd.get('q') || '').trim(),
      niche: fd.get('niche') || '',
      builder: fd.get('builder') || '',
      dr: fd.get('dr') || '',
      since: fd.get('since') || '',
      sort: fd.get('sort') || '',
      all: fd.get('all') ? '1' : '',
      adult: fd.get('adult') ? '1' : '',
      page: 1,
    }),
  );
}

function fieldRows(site) {
  const rows = [
    ['Ніші', (site.ai_categories || []).join(', ') || 'н/д'],
    ['Domain Rating', formatDr(site.dr)],
    ['Вперше відповів (went_live)', formatDate(site.went_live)],
    ['Домен помічено (first_seen)', formatDate(site.first_seen)],
    ['Стек / конструктор', site.ai_source ? builderLabel(site.ai_source) : 'н/д'],
    ['Вебсервер', site.webserver || 'н/д'],
    ['Доменна зона', site.tld ? `.${site.tld}` : 'н/д'],
    ['HTTP-статус', site.http_status ?? 'н/д'],
    ['Тексту на головній', site.content_length ? `${formatNumber(Math.round(site.content_length / 1024))} КБ` : 'н/д'],
    ['Оновлено в індексі', formatDate(site.fetched_at)],
  ];
  return rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
}

async function renderSite(signal, rawDomain) {
  const domain = normalizeDomain(decodeURIComponent(rawDomain || ''));
  if (!domain) {
    view.innerHTML = `<div class="notice"><p>Некоректний домен.</p><a class="btn" href="#/catalog">До каталогу</a></div>`;
    return;
  }
  view.innerHTML = `<p class="crumbs"><a href="#/catalog">Каталог</a> / ${esc(domain)}</p><div id="site">${skeleton(1)}</div>`;
  try {
    const site = await getSite(domain, { signal });
    if (signal.aborted) return;
    if (!site) {
      document.getElementById('site').innerHTML = `<div class="notice">
        <p><strong>${esc(domain)}</strong> немає в індексі FreeSerp Main. Індекс містить головні сторінки сайтів, які його робот знайшов і перевірив; великі старі сайти там є не завжди.</p>
        <a class="btn" href="#/catalog?${esc(catalogQuery({ q: domain, all: '1' }))}">Шукати схожі за назвою</a></div>`;
      return;
    }
    const href = safeUrl(site.url) || `https://${domain}`;
    document.title = `${domain}: AI Radar`;
    document.getElementById('site').innerHTML = `
      <article class="profile">
        <header class="profile-head">
          ${favicon(domain)}
          <div>
            <h1>${esc(domain)}</h1>
            <p class="muted">${esc(site.title || '')}</p>
          </div>
        </header>
        <p class="profile-summary">${esc(site.ai_summary || 'Опису ще немає.')}</p>
        ${nicheTags(site.ai_categories, 6)}
        <div class="card-actions">
          <a class="btn btn-primary" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">Відкрити сайт ↗</a>
          ${compareButton(domain)}
        </div>
        <table class="facts"><caption class="sr-only">Дані про сайт</caption><tbody>${fieldRows(site)}</tbody></table>
        <p class="muted small">«Вперше відповів» це дата, коли робот FreeSerp уперше побачив сайт живим, а не офіційний запуск продукту. DR рахує FreeSerp за власним графом посилань.</p>
      </article>
      <section aria-labelledby="similar-h"><h2 id="similar-h">Схожі в ніші${site.ai_categories?.[0] ? ` «${esc(site.ai_categories[0])}»` : ''}</h2><div id="similar">${skeleton(3)}</div></section>`;

    const niche = site.ai_categories?.[0];
    const similarEl = document.getElementById('similar');
    if (!niche) {
      similarEl.innerHTML = '<p class="muted">У сайту не визначена ніша.</p>';
      return;
    }
    const data = await query({ ai_startups: 1, ai_categories: niche, sort: 'dr', order: 'desc', size: 12 }, { signal });
    if (signal.aborted) return;
    const similar = safeOnly(data.results).filter((r) => r.domain !== domain).slice(0, 6);
    similarEl.innerHTML = similar.length ? grid(similar) : '<p class="muted">Схожих не знайшлось.</p>';
  } catch (err) {
    if (err.name === 'AbortError') return;
    document.getElementById('site').innerHTML = errorBox(err);
  }
}

async function renderCompare(signal, queryString) {
  const fromUrl = new URLSearchParams(queryString || '').get('d');
  let list = getCompare();
  if (fromUrl !== null) {
    list = parseCompareList(fromUrl);
    setCompare(list);
  }

  view.innerHTML = `
    <div class="section-head"><h1>Порівняння</h1></div>
    <form class="hero-search compact" data-form="compare-add">
      <label class="sr-only" for="cmp-domain">Домен</label>
      <input id="cmp-domain" name="domain" placeholder="Додати домен, наприклад socixis.dev" autocomplete="off">
      <button class="btn btn-primary" type="submit">Додати</button>
    </form>
    <div id="compare">${list.length ? skeleton(list.length) : ''}</div>`;

  if (!list.length) {
    document.getElementById('compare').innerHTML = `<div class="notice"><p>Список порожній. Додайте сайти кнопкою «+ Порівняти» в <a href="#/catalog">каталозі</a> або введіть домен вище. До ${MAX_COMPARE} сайтів.</p></div>`;
    return;
  }

  const settled = await Promise.allSettled(list.map((d) => getSite(d, { signal })));
  if (signal.aborted) return;
  const sites = list.map((domain, i) => ({
    domain,
    site: settled[i].status === 'fulfilled' ? settled[i].value : null,
    error: settled[i].status === 'rejected' ? settled[i].reason : null,
  }));

  const drs = sites.map((s) => (typeof s.site?.dr === 'number' ? s.site.dr : null));
  const bestDr = bestIndex(drs, 'max');
  const cell = (i, html, best = false) => `<td${best ? ' class="best"' : ''}>${html}</td>`;
  const row = (label, fn, bestCol = -1) =>
    `<tr><th scope="row">${esc(label)}</th>${sites
      .map((s, i) => cell(i, s.site ? fn(s.site) : '<span class="muted">н/д</span>', i === bestCol))
      .join('')}</tr>`;

  const shareUrl = `${location.origin}${location.pathname}#/compare?d=${list.map(encodeURIComponent).join(',')}`;
  document.getElementById('compare').innerHTML = `
    <div class="table-wrap">
      <table class="compare">
        <thead><tr><th scope="col"><span class="sr-only">Поле</span></th>${sites
          .map(
            (s) => `<th scope="col"><div class="cmp-head">${favicon(s.domain)}<a href="#/site/${esc(encodeURIComponent(s.domain))}">${esc(s.domain)}</a>
              <button type="button" class="icon-btn" data-remove="${esc(s.domain)}" aria-label="Прибрати ${esc(s.domain)}">×</button></div>
              ${s.site ? '' : `<p class="muted small">${s.error ? 'помилка завантаження' : 'немає в індексі'}</p>`}</th>`,
          )
          .join('')}</tr></thead>
        <tbody>
          ${row('Опис', (x) => `<p class="summary-full">${esc(x.ai_summary || 'н/д')}</p>`)}
          ${row('Ніші', (x) => esc((x.ai_categories || []).join(', ') || 'н/д'))}
          ${row('Domain Rating', (x) => esc(formatDr(x.dr)), bestDr)}
          ${row('Вперше відповів', (x) => esc(formatDate(x.went_live)))}
          ${row('Домен помічено', (x) => esc(formatDate(x.first_seen)))}
          ${row('Стек', (x) => esc(x.ai_source ? builderLabel(x.ai_source) : 'н/д'))}
          ${row('Вебсервер', (x) => esc(x.webserver || 'н/д'))}
          ${row('Зона', (x) => esc(x.tld ? `.${x.tld}` : 'н/д'))}
        </tbody>
      </table>
    </div>
    <div class="card-actions">
      <button type="button" class="btn" data-copy="${esc(shareUrl)}">Скопіювати посилання на порівняння</button>
      <button type="button" class="btn btn-ghost" data-action="clear-compare">Очистити</button>
    </div>
    ${bestDr >= 0 ? '<p class="muted small">Підсвічено найвищий Domain Rating.</p>' : ''}`;
}

function renderAbout() {
  view.innerHTML = document.getElementById('about-template').innerHTML;
}

function renderNotFound() {
  view.innerHTML = `<div class="notice"><h1>Сторінку не знайдено</h1><a class="btn" href="#/">На головну</a></div>`;
}

// ---------- router ----------

function currentRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  return { path, query };
}

let navController = null;
let lastPath = null;

async function route() {
  const { path, query } = currentRoute();
  navController?.abort();
  navController = new AbortController();
  const { signal } = navController;

  const parts = path.split('/').filter(Boolean);
  const section = parts[0] || '';
  // Keep the catalog form (and focus) alive while only its filters change.
  if (!(section === 'catalog' && lastPath === 'catalog')) {
    view.innerHTML = '';
    window.scrollTo(0, 0);
  }
  lastPath = section;
  document.title = 'AI Radar: нові AI-продукти';
  document.querySelectorAll('.nav a').forEach((a) => {
    const target = a.getAttribute('href').replace(/^#\/?/, '').split('?')[0];
    a.toggleAttribute('aria-current', target === section);
  });

  if (section === '') return renderOverview(signal);
  if (section === 'catalog') return renderCatalog(signal, query);
  if (section === 'site') return renderSite(signal, parts.slice(1).join('/'));
  if (section === 'compare') return renderCompare(signal, query);
  if (section === 'about') return renderAbout();
  return renderNotFound();
}

// ---------- events ----------

// A shared ?d= link would overwrite the list again, so after an edit we drop it from the URL.
function goCompare() {
  if (location.hash === '#/compare') route();
  else location.hash = '#/compare';
}

let typingTimer = null;
function pushCatalog(form) {
  const qs = catalogQuery(formState(form));
  const target = `#/catalog${qs ? `?${qs}` : ''}`;
  if (location.hash !== target) location.hash = target;
}

document.addEventListener('input', (e) => {
  const form = e.target.closest('#catalog-form');
  if (!form) return;
  clearTimeout(typingTimer);
  if (e.target.name === 'q') typingTimer = setTimeout(() => pushCatalog(form), 450);
  else pushCatalog(form);
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.id === 'catalog-form') {
    clearTimeout(typingTimer);
    pushCatalog(form);
  } else if (form.dataset.form === 'hero') {
    const q = form.elements.q.value.trim();
    location.hash = `#/catalog?${catalogQuery({ q, sort: q ? 'relevance' : 'went_live' })}`;
  } else if (form.dataset.form === 'compare-add') {
    const domain = normalizeDomain(form.elements.domain.value);
    if (!domain) return toast('Введіть домен, наприклад example.ai');
    const list = getCompare();
    if (list.includes(domain)) return toast(`${domain} вже в порівнянні`);
    if (list.length >= MAX_COMPARE) return toast(`Максимум ${MAX_COMPARE} сайти`);
    setCompare([...list, domain]);
    goCompare();
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.compare) return toggleCompare(btn.dataset.compare);
  if (btn.dataset.remove) {
    setCompare(getCompare().filter((d) => d !== btn.dataset.remove));
    return goCompare();
  }
  if (btn.dataset.copy) {
    navigator.clipboard?.writeText(btn.dataset.copy).then(
      () => toast('Посилання скопійовано'),
      () => toast(btn.dataset.copy),
    );
    return;
  }
  const action = btn.dataset.action;
  if (action === 'retry') route();
  if (action === 'reset') location.hash = '#/catalog';
  if (action === 'clear-compare') {
    setCompare([]);
    goCompare();
  }
});

// Broken favicon -> letter avatar. `error` does not bubble, so listen in the capture phase.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('fav')) return;
    const span = document.createElement('span');
    span.className = 'fav fav-letter';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = img.dataset.letter || '?';
    img.replaceWith(span);
  },
  true,
);

document.getElementById('repo-link').href = REPO_URL;
window.addEventListener('hashchange', route);
window.addEventListener('storage', (e) => e.key === COMPARE_KEY && renderCompareBadge());
renderCompareBadge();
route();

