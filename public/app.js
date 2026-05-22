// Rafraîchit les valeurs et redessine les sparklines toutes les 60 s, sans recharger la page.
function sparkPts(history, w = 120, h = 36) {
  const pts = (history || []).filter((n) => Number.isFinite(n));
  if (!pts.length) return null;
  if (pts.length === 1) return [[0, h / 2], [w, h / 2]];
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1, step = w / (pts.length - 1);
  return pts.map((v, i) => [+(i * step).toFixed(2), +(h - ((v - min) / span) * h).toFixed(2)]);
}

function sparkPath(history) {
  const p = sparkPts(history);
  if (!p) return '';
  return p.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
}

function sparkArea(history, w = 120, h = 36) {
  const p = sparkPts(history, w, h);
  if (!p) return '';
  return `${p.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')} L${w},${h} L0,${h} Z`;
}

async function refresh() {
  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) return;
    const model = await res.json();
    for (const section of model.sections) {
      for (const card of section.cards) {
        if (card.hidden) continue;
        const el = document.querySelector(`.card[data-id="${card.id}"]`);
        if (!el) continue;
        const valueEl = el.querySelector('.card-value');
        if (valueEl?.firstChild) valueEl.firstChild.nodeValue = card.displayValue;
        el.classList.toggle('is-stale', !!card.stale);
        const line = el.querySelector('.spark-line');
        if (line) line.setAttribute('d', sparkPath(card.history));
        const areaEl = el.querySelector('.spark-area');
        if (areaEl) areaEl.setAttribute('d', sparkArea(card.history));
      }
    }
  } catch { /* réseau indispo : on garde l'affichage courant */ }
}

setInterval(refresh, 60000);
