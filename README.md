# IPHR Dashboard

Dashboard macro/marchés « Régime IPHR — Inflation-Push Hawkish Repricing ». Service Node.js
qui agrège des indicateurs (pétrole, taux, anticipations d'inflation, stocks, salaires) depuis
FRED et Yahoo Finance, avec repli sur des valeurs configurables, et les affiche en thème sombre.

En ligne : https://iphr.gheop.com

## Installation

```bash
npm install
cp .env.example .env   # renseigner FRED_API_KEY (clé gratuite : https://fredaccount.stlouisfed.org/apikeys)
npm start              # http://localhost:8080
```

Sans `FRED_API_KEY`, l'app démarre quand même sur les valeurs de repli.

## Tests

```bash
npm test
```

## Données

- Live : FRED (taux, breakevens, Michigan, 5Y5Y forward, Atlanta wage, stocks pétroliers US) et
  Yahoo Finance (Brent, WTI, RBOB, Heating Oil pour le crack spread, MOVE).
- Repli config (`config/indicators.json`) : indicateurs sans source gratuite (ISM Prices Paid,
  OECD on-land, floating storage, backwardation, 5Y5Y swap, salaires UE) et bloc scénario.

## Analyse IA

Le bloc scénario et les badges des cartes sans source de marché sont régénérés une fois par jour
par l'API Anthropic, à partir des valeurs live du dashboard. Nécessite `ANTHROPIC_API_KEY` ;
sans elle, le dashboard retombe sur le texte statique du config.

## Origine

L'idée de ce dashboard vient de la vidéo « Point de marché : Ce que les marchés ne vous disent
PAS sur le retour de l'inflation (Mai 2026) » : https://www.youtube.com/watch?v=zwg25zZMMpU

## Licence

WTFPL — voir [LICENSE](LICENSE). Fais-en ce que tu veux.

## Changelog

### v0.2.0 — Analyse IA quotidienne et favicon (2026-05-22)

- Bloc scénario (spirale / pas de spirale, probabilités, seuils) régénéré chaque jour par
  l'API Anthropic (Sonnet 4.6) à partir des valeurs live ; chiffres des cartes jamais touchés
- Badges éditoriaux des cartes sans source live décidés par l'IA (tone contraint)
- Repli propre : sans clé ou en cas d'erreur, on garde la dernière analyse ou le texte du config
- Favicon au thème sombre

### v0.1.1 — Sources réelles, footer public et courbes remplies (2026-05-22)

- Sources affichées corrigées (FRED / Yahoo / repli config) dans l'en-tête et chaque carte
- Repo passé en public, footer avec lien vers le code source
- Remplissage dégradé translucide sous les sparklines
- README : origine (vidéo) ajoutée, sections internes retirées, lien vers l'appli en ligne
- Licence WTFPL

### v0.1.0 — Première version (2026-05-22)

- Dashboard IPHR : 5 sections d'indicateurs + bloc scénario spirale/pas de spirale + seuils
- Données live FRED + Yahoo, repli sur valeurs configurables
- Sparklines SVG, thème sombre, rafraîchissement client toutes les 60 s
- Déploiement k3s à iphr.gheop.com (Traefik + TLS Let's Encrypt)
