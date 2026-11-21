// Comptage des vues du dashboard au format texte Prometheus, sans dépendance.
// Seul GET / compte : le front rappelle /api/data toutes les 60 s, compter les
// requêtes mesurerait la durée des onglets ouverts, pas les visites.

const BOT_UA = /bot|crawl|spider|slurp|scan|preview|monitor|uptime|headless|lighthouse|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|libwww|httpclient|facebookexternalhit|embedly|whatsapp|telegram|discord|slack/i;

export function isBot(userAgent) {
  return !userAgent || BOT_UA.test(userAgent);
}

export function createViewCounter() {
  const views = { human: 0, bot: 0 };
  return {
    record(userAgent) {
      views[isBot(userAgent) ? 'bot' : 'human'] += 1;
    },
    render() {
      return [
        '# HELP iphr_page_views_total Vues de la page du dashboard (GET /), humains et robots séparés par user-agent.',
        '# TYPE iphr_page_views_total counter',
        `iphr_page_views_total{kind="human"} ${views.human}`,
        `iphr_page_views_total{kind="bot"} ${views.bot}`,
        '',
      ].join('\n');
    },
  };
}
