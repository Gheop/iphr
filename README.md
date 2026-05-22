# IPHR Dashboard

Dashboard macro/marchés « Régime IPHR — Inflation-Push Hawkish Repricing ». Service Node.js
qui agrège des indicateurs (pétrole, taux, anticipations d'inflation, stocks, salaires) depuis
FRED et Yahoo Finance, avec repli sur des valeurs configurables, et les affiche en thème sombre.

## Pour qui

Usage interne Gheop. En ligne sur https://iphr.gheop.com.

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

## Déploiement

Push sur `master` → GitHub Actions build l'image `ghcr.io/gheop/iphr`, la pousse, puis
déploie par SSH sur le k3s (`kubectl set image`). Manifests dans `k3s/` (à appliquer une fois,
copiés dans `Gheop/k3s/iphr/`).

## Changelog

### v0.1.0 — Première version (2026-05-22)

- Dashboard IPHR : 5 sections d'indicateurs + bloc scénario spirale/pas de spirale + seuils
- Données live FRED + Yahoo, repli sur valeurs configurables
- Sparklines SVG, thème sombre, rafraîchissement client toutes les 60 s
- Déploiement k3s à iphr.gheop.com (Traefik + TLS Let's Encrypt)
