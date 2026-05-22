function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function sparklinePath(history, w = 120, h = 36) {
  const pts = (history || []).filter((n) => Number.isFinite(n));
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M0,${h / 2} L${w},${h / 2}`;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = w / (pts.length - 1);
  return pts
    .map((v, i) => {
      const x = (i * step).toFixed(2);
      const y = (h - ((v - min) / span) * h).toFixed(2);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

function renderCard(card) {
  if (card.hidden) return '';
  const badge = card.badge
    ? `<span class="badge tone-${esc(card.badge.tone)}">${esc(card.badge.text)}</span>`
    : '';
  const stale = card.stale ? '<span class="stale" title="valeur en cache">•</span>' : '';
  const d = sparklinePath(card.history);
  return `
    <article class="card${card.stale ? ' is-stale' : ''}" data-id="${esc(card.id)}">
      <header><span class="card-label">${esc(card.label)}</span>${badge}</header>
      <div class="card-tag">${esc(card.sourceTag)}</div>
      <div class="card-value">${esc(card.displayValue)}${stale}</div>
      <div class="card-context">${esc(card.context)}</div>
      <svg class="spark tone-${esc(card.badge?.tone || 'neutral')}" viewBox="0 0 120 36" preserveAspectRatio="none">
        <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </article>`;
}

function renderSection(section) {
  const cards = section.cards.map(renderCard).join('');
  return `<section class="block">
    <h2 class="block-title"><span>${esc(section.id)}</span> — ${esc(section.title)}</h2>
    <div class="grid">${cards}</div>
  </section>`;
}

function renderScenario(s) {
  const list = (arr) => (arr || []).map((b) => `<li>${esc(b)}</li>`).join('');
  return `<section class="scenario">
    <div class="scen scen-spiral">
      <h3>${esc(s.spiral.label)} <span>${esc(s.spiral.probability)}</span></h3>
      <ul>${list(s.spiral.bullets)}</ul>
    </div>
    <div class="scen scen-nospiral">
      <h3>${esc(s.noSpiral.label)} <span>${esc(s.noSpiral.probability)}</span></h3>
      <ul>${list(s.noSpiral.bullets)}</ul>
    </div>
  </section>
  <section class="thresholds">
    <h3>Seuils de bascule à surveiller</h3>
    <ul>${list(s.thresholds)}</ul>
  </section>`;
}

export function renderHtml(model) {
  const date = new Date(model.meta.refreshedAt || Date.now()).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(model.meta.title || 'IPHR')}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main>
    <header class="page-head">
      <h1>${esc(model.meta.title)}</h1>
      <div class="meta-row">
        <span class="pill">${esc(model.meta.subtitle)} · ${esc(date)}</span>
        <span class="sources">${esc(model.meta.sources)}</span>
      </div>
    </header>
    ${model.sections.map(renderSection).join('')}
    ${renderScenario(model.scenario)}
    <footer class="page-foot">
      Fait avec <span class="heart" aria-hidden="true">♥</span> par Gheop ·
      <a href="https://github.com/Gheop/iphr" target="_blank" rel="noopener">code source sur GitHub</a>
    </footer>
  </main>
  <script src="/app.js"></script>
</body>
</html>`;
}
