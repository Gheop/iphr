import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBot, createViewCounter } from '../src/metrics.js';

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1';

test('isBot reconnaît les navigateurs comme humains', () => {
  assert.equal(isBot(FIREFOX), false);
  assert.equal(isBot(IPHONE), false);
});

test('isBot classe robots, outils et user-agent absent comme robots', () => {
  for (const ua of [
    undefined,
    '',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'curl/8.11.0',
    'python-requests/2.32.3',
    'Go-http-client/1.1',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
    'facebookexternalhit/1.1',
  ]) {
    assert.equal(isBot(ua), true, String(ua));
  }
});

test('le compteur sépare humains et robots au format Prometheus', () => {
  const counter = createViewCounter();
  counter.record(FIREFOX);
  counter.record(IPHONE);
  counter.record('curl/8.11.0');
  const text = counter.render();
  assert.match(text, /^# TYPE iphr_page_views_total counter$/m);
  assert.match(text, /^iphr_page_views_total\{kind="human"\} 2$/m);
  assert.match(text, /^iphr_page_views_total\{kind="bot"\} 1$/m);
  assert.ok(text.endsWith('\n'));
});
