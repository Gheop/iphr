# IPHR Dashboard — Design

Date : 2026-05-22
Statut : validé pour rédaction du plan d'implémentation

## Objectif

Recréer en Node.js le dashboard macro/marchés « Régime IPHR — Inflation-Push Hawkish
Repricing » vu sur 3 captures, avec données live là où une source API gratuite existe, le
reste en valeurs configurables. Héberger sur le k3s de gheop.com à `iphr.gheop.com`, via le
même schéma CI/CD que les autres projets Gheop (build → GHCR → SSH `kubectl set image`).

Fidélité visuelle : ressemblant (thème sombre, cartes, badges, sparklines, sections), pas
pixel-perfect.

## Contenu du dashboard

En-tête : titre « Régime IPHR — Inflation-Push Hawkish Repricing », badge « DASHBOARD · <date> »,
ligne de sources « Bloomberg · FMP · Data Puller V2 — données J+1/J · choc Hormuz démarré
février 2026 ».

Chaque carte affiche : libellé, badge de catégorie/source (ex. `$/bbl · BBG CO1`), badge d'état
(CHOC, SPIKE, ÉLEVÉ, ANCRÉ, VERROU OK…), grande valeur, ligne de contexte, sparkline.

### Indicateurs et sources

| # | Indicateur | Unité | Source live | Série / calcul |
|---|------------|-------|-------------|----------------|
| 01 | Brent Crude | $/bbl | Yahoo | `BZ=F` |
| 01 | WTI Crude | $/bbl | Yahoo | `CL=F` |
| 01 | Crack Spread 3-2-1 | $/bbl | Yahoo (calcul) | `(2·RB=F·42 + HO=F·42) − 3·CL=F) / 3` (RBOB & HO en $/gal → ×42) |
| 01 | Backwardation Brent | % | config | courbe futures, non dispo gratuitement |
| 02 | Treasury US 30 ans | % | FRED | `DGS30` |
| 02 | Breakeven 10 ans | % | FRED | `T10YIE` |
| 02 | MOVE Index | pts | Yahoo | `^MOVE` (fallback config si indispo) |
| 02 | High Yield OAS | bps | FRED | `BAMLH0A0HYM2` |
| 03 | Michigan 1 an | % | FRED | `MICH` |
| 03 | 5Y5Y Inflation Swap | % | config | swap exact non dispo gratuitement |
| 03 | 5Y5Y Forward TIPS | % | FRED | `T5YIFR` |
| 03 | ISM Prices Paid | pts | config | ISM propriétaire |
| 04 | SPR US | mb | FRED | `WCSSTUS1` |
| 04 | US Commercial Crude | mb | FRED | `WCESTUS1` |
| 04 | OECD On-land Total | mb | config | IEA propriétaire |
| 04 | Floating Storage | mb | config | Vortexa/Kpler propriétaire |
| 05 | Atlanta Fed Wage Tracker | % | FRED | `FRBATLWGT3MMAUMHWGO` |
| 05 | Salaires négociés EU | % | config | ECB trimestriel |

Note sur les unités stocks pétroliers : les séries FRED `WCESTUS1`/`WCSSTUS1` sont en milliers de
barils → diviser par 1000 pour obtenir des mb (millions de barils). À vérifier à l'implémentation
contre les valeurs des captures (Commercial Crude ≈ 453 mb, SPR ≈ 384 mb).

### Bloc scénario (éditorial, config)

- « Scénario spirale » (≈ 25-30 %) : 5 puces (thème rouge/rose).
- « Pas de spirale » (≈ 70-75 %) : 5 puces (thème vert/teal).
- « Seuils de bascule à surveiller » : liste de seuils (Discours Warsh FOMC 17 juin 2026,
  5Y5Y swap > 2,80 %, Atlanta wage > 4,5 %, HY OAS > 290 bps, SPR > 347 mb).

Le texte exact des puces et seuils reprend les captures et vit dans `config/indicators.json`.

## Architecture

Service Node.js unique (Express), un conteneur, un Deployment.

```
src/
  server.js            # Express : sert le HTML rendu + /api/data + /healthz
  scheduler.js         # rafraîchit les sources toutes les ~30 min, au boot aussi
  sources/
    fred.js            # client FRED (clé via env), 1 série → {value, history[]}
    yahoo.js           # client Yahoo Finance (sans clé), quote + historique
  compute.js           # crack spread, badges d'état (seuils), assemblage du modèle
  cache.js             # lecture/écriture cache JSON sur disque (data/cache.json)
  render.js            # génère le HTML + sparklines SVG côté serveur
config/
  indicators.json      # libellés, ordre des sections, sources/séries, seuils de badge,
                       # valeurs des indicateurs en fallback, bloc scénario
public/
  styles.css           # thème sombre
  app.js               # rafraîchit /api/data, redessine les sparklines client
data/cache.json        # dernières valeurs + historique court (gitignore)
```

### Flux de données

1. Au démarrage et toutes les ~30 min, `scheduler` lit `config/indicators.json`, appelle
   FRED/Yahoo pour les indicateurs `source: live`, conserve la dernière valeur + un historique
   court (≈ 30-60 points) par série, écrit `data/cache.json`.
2. Les indicateurs `source: config` prennent leur valeur/historique depuis le JSON.
3. `compute.js` calcule le crack spread, applique les seuils → badge d'état par carte, assemble
   le modèle complet (sections, cartes, scénario).
4. `server.js` sert le HTML rendu (SSR) au chargement et expose `/api/data` (JSON) pour le
   rafraîchissement client. `app.js` redessine les sparklines.

### Badges d'état

Calculés par `compute.js` à partir de seuils définis dans `config/indicators.json` (ex. Brent
au-dessus d'un seuil → `CHOC`, MOVE au-dessus d'un seuil → `SPIKE`, salaires sous un seuil →
`VERROU OK`). Couleur du badge dérivée de la catégorie (alerte = rouge/orange, ok = vert,
neutre = bleu/gris).

### Sparklines

Tracées en SVG. Au SSR par `render.js` à partir de l'historique ; redessinées côté client par
`app.js` après un `/api/data`. Pas de lib de charting lourde.

## Gestion des erreurs

- Une source qui échoue (timeout, 4xx/5xx, clé manquante) : on garde la dernière valeur connue
  du cache et on marque l'indicateur `stale` (petit indicateur visuel discret). Le scheduler
  log l'erreur, ne crashe pas.
- `data/cache.json` absent au premier boot : on rend d'abord les valeurs `config`, puis le
  premier cycle de fetch complète les valeurs live.
- Clé FRED absente : les indicateurs FRED tombent en `config` (valeurs des captures) avec un log
  d'avertissement, l'app démarre quand même.
- `/healthz` renvoie 200 dès que le serveur écoute (indépendant de l'état des fetchs).

## Configuration

- `FRED_API_KEY` (env) : clé gratuite FRED. Absente en CI ; fournie en runtime via secret k8s
  `iphr-app-secrets`. En local via `.env` (gitignore), `.env.example` documenté.
- `PORT` (def. 8080), `REFRESH_INTERVAL_MIN` (def. 30).

## Tests

- `compute.js` : crack spread (valeurs connues → résultat attendu), logique de badge par seuil
  (sous/au-dessus/égal), conversion d'unités stocks (milliers → mb).
- `cache.js` : round-trip écriture/lecture, dégradation propre si fichier corrompu/absent.
- `sources/*` : parsing de réponses FRED/Yahoo fixées (fixtures), pas d'appel réseau réel en test.
- `render.js` : génération SVG sparkline (chemin non vide pour une série donnée), HTML contient
  les sections attendues.

## Déploiement (calqué sur `reader`)

- Repo privé **`Gheop/iphr`**.
- `Dockerfile` (Node LTS, `npm ci --omit=dev`, port 8080).
- `.github/workflows/deploy.yml` : sur push `master`, build → push `ghcr.io/gheop/iphr:latest`
  et `:${sha}`, puis SSH (`appleboy/ssh-action`, secrets org `SSH_HOST/USER/PRIVATE_KEY/PORT`)
  → `kubectl set image deployment/iphr iphr=ghcr.io/gheop/iphr:${sha} -n iphr` + rollout status.
- Manifests dans **`Gheop/k3s/iphr/`** :
  - `namespace.yaml` (ns `iphr`)
  - `deployment.yaml` (image `ghcr.io/gheop/iphr:latest`, `imagePullSecrets: ghcr-pull-secret`,
    `envFrom secretRef iphr-app-secrets`, port 8080, requests/limits modestes, probes sur
    `/healthz`)
  - `service.yaml` (NodePort **30082**, port 80 → targetPort 8080)
  - `ingress.yaml` (Traefik, `websecure`, certresolver `letsencrypt`, host `iphr.gheop.com`)
  - `secrets.yaml.example` (gabarit `FRED_API_KEY`)

### Actions manuelles requises (côté utilisateur, une fois)

1. Créer une clé FRED gratuite (https://fredaccount.stlouisfed.org/apikeys).
2. Sur l'hôte k3s : créer le secret `iphr-app-secrets` (avec `FRED_API_KEY`) et le
   `ghcr-pull-secret` dans le ns `iphr`, puis `kubectl apply -f .../k3s/iphr/`.
3. DNS : `iphr.gheop.com` → IP du cluster (163.172.75.204).

## Hors périmètre (YAGNI)

- Pas d'auth (dashboard public en lecture seule, comme les sources affichées).
- Pas de base de données (cache JSON suffit).
- Pas de données intraday temps réel < 30 min.
- Pas de reconstruction des courbes futures pour la backwardation (config).
- Pas de branche `dev`/beta au départ (ajoutable plus tard).

## Changelog initial

`v0.1.0` à la première mise en ligne.
