import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { call, loadFixture } from './helpers';

beforeEach(loadFixture);

// Follow the anchors emitted by the pages and all asset redirects, just as navigation does.
async function navigate(path: string) {
  for (let i = 0; i < 5; i++) {
    const r = await call(path);
    if (r.status >= 300 && r.status < 400) {
      path = new URL(r.headers.get('location')!, 'https://minty.example.workers.dev' + path).pathname;
      continue;
    }
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    return { path, html: await r.text() };
  }
  throw Error('Too many redirects');
}
function tab(html: string, label: string) {
  const nav = html.match(/<nav class="main-tabs"[^>]*>([\s\S]*?)<\/nav>/)![1];
  const link = [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].find(m => m[2] === label);
  expect(link, `${label} navigation anchor`).toBeDefined();
  return link![1];
}

it('navigates Transactions → Accounts → Transactions without landing on the JSON API or changing saved accounts', async () => {
  const before = await env.DB.prepare('SELECT * FROM accounts ORDER BY id').all();
  let page = await navigate('/');
  expect(page.html).toContain('id="ownerSeg"');
  page = await navigate(tab(page.html, 'Accounts'));
  expect(page.path).toBe('/account-overview');
  expect(page.html).toContain('id="accountList"');
  expect(page.html).toContain('/accounts-overview.js');
  expect(page.html).toContain('href="/?audit"');
  expect(page.html).toContain('href="/?egg"');
  page = await navigate(tab(page.html, 'Transactions'));
  expect(page.path).toBe('/');
  expect(page.html).toContain('/app.js');
  expect(page.html).toContain('id="ownerSeg"');
  const api = await call('/accounts');
  expect(api.headers.get('content-type')).toContain('application/json');
  expect(await api.json()).toHaveLength(3);
  expect((await env.DB.prepare('SELECT * FROM accounts ORDER BY id').all()).results).toEqual(before.results);
});

it('serves the HTML filename safely even when local assets do not canonicalize it', async () => {
  const page = await navigate('/account-overview.html');
  expect(['/account-overview', '/account-overview.html']).toContain(page.path);
  expect(page.html).toContain('id="accountList"');
});
