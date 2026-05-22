import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildModel } from './compute.js';
import { renderHtml } from './render.js';
import { start } from './scheduler.js';
import { startAi } from './ai-scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'config/indicators.json'), 'utf8'));

let latestFetched = {};
let latestAi = null;
let model = buildModel(config, latestFetched, latestAi);

function rebuild() {
  model = buildModel(config, latestFetched, latestAi);
}

// Données marché (toutes les ~30 min)
start(config, (fetched) => {
  latestFetched = fetched;
  rebuild();
  console.log(`[iphr] données marché rafraîchies à ${model.meta.refreshedAt}`);
});

// Analyse IA (1×/jour) — nourrie par le modèle marché courant
startAi(
  () => buildModel(config, latestFetched),
  (ai) => {
    latestAi = ai;
    rebuild();
    console.log(`[iphr] analyse IA appliquée (générée ${ai.generatedAt})`);
  },
);

const app = express();
app.use(express.static(join(root, 'public')));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/api/data', (_req, res) => res.json(model));
app.get('/', (_req, res) => res.type('html').send(renderHtml(model)));

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`[iphr] écoute sur :${port}`));
