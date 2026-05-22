import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildModel } from './compute.js';
import { renderHtml } from './render.js';
import { start } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'config/indicators.json'), 'utf8'));

let model = buildModel(config, {}); // valeurs fallback avant le premier fetch

start(config, (fetched) => {
  model = buildModel(config, fetched);
  console.log(`[iphr] modèle rafraîchi à ${model.meta.refreshedAt}`);
});

const app = express();
app.use(express.static(join(root, 'public')));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/api/data', (_req, res) => res.json(model));
app.get('/', (_req, res) => res.type('html').send(renderHtml(model)));

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`[iphr] écoute sur :${port}`));
