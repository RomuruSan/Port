import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { makeIso } from '../support/iso-fixture.js';

async function appFor(t, settings = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'port-api-'));
  const server = await createApp({ dataDir: directory, engineDir: join(directory, 'missing-engine'), ...settings });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await server.stopWork();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, url: `http://127.0.0.1:${server.address().port}` };
}

test('serves the app and accurately reports an unconfigured native engine', async t => {
  const { url } = await appFor(t);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Haunting Ground/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const status = await fetch(`${url}/api/status`).then(response => response.json());
  assert.equal(status.engine.available, false);
  assert.deepEqual(status.projects, []);
  assert.equal((await fetch(`${url}/src/server.js`)).status, 404);
});

test('streams an ISO, analyzes it, blocks an unsupported build and allows removal', async t => {
  const { url, directory } = await appFor(t);
  const response = await fetch(`${url}/api/uploads?name=example.iso`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: makeIso() });
  assert.equal(response.status, 201);
  const upload = await response.json();
  assert.equal(upload.serial, 'SLUS_210.75');
  assert.equal(upload.compatibility.supported, false);
  assert.equal(upload.sha256.length, 64);
  assert.equal((await readFile(join(directory, 'uploads', upload.id, 'source.iso'))).length, 65536);
  const build = await fetch(`${url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: upload.id }) });
  assert.equal(build.status, 422);
  assert.deepEqual(await readdir(join(directory, 'projects')), []);
  assert.equal((await fetch(`${url}/api/uploads/${upload.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await readdir(join(directory, 'uploads')), []);
});

test('invalid images are rejected and partial files are removed', async t => {
  const { url, directory } = await appFor(t);
  const response = await fetch(`${url}/api/uploads?name=broken.iso`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(2000) });
  assert.equal(response.status, 422);
  assert.deepEqual(await readdir(join(directory, 'uploads')), []);
});

test('rejects cross-origin writes, oversized uploads and unsafe project IDs', async t => {
  const { url, directory } = await appFor(t, { maxUpload: 100 });
  const crossOrigin = await fetch(`${url}/api/uploads?name=disc.iso`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Origin: 'https://untrusted.example' }, body: 'data' });
  assert.equal(crossOrigin.status, 403);
  const oversized = await fetch(`${url}/api/uploads?name=disc.iso`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(101) });
  assert.equal(oversized.status, 413);
  const traversal = await fetch(`${url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: '../../other.iso' }) });
  assert.equal(traversal.status, 400);
  assert.deepEqual(await readdir(join(directory, 'uploads')), []);
});

test('records interrupted jobs as failures on restart and removes only their partial output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'port-restart-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = '11111111-1111-4111-8111-111111111111';
  await mkdir(join(root, 'records'), { recursive: true });
  await mkdir(join(root, 'projects', `${id}.building`), { recursive: true });
  await writeFile(join(root, 'records', `${id}.json`), JSON.stringify({ id, stage: 'importing' }));
  const { url } = await appFor(t, { dataDir: root });
  const status = await fetch(`${url}/api/status`).then(response => response.json());
  assert.equal(status.projects[0].stage, 'failed');
  assert.match(status.projects[0].error, /interrompida/);
  assert.deepEqual(await readdir(join(root, 'projects')), []);
});
