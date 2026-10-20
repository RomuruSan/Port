import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { analyzeInput, appendDiscArtifact, parseSfo, reportMarkdown } from '../src/analyzer.js';
import { extractEntry, listDisc, parseListing } from '../src/archive.js';
import { makeDisc, makeFirmware, makeSfo } from '../support/disc-fixture.js';

async function workspace(t, bytes, extension = 'iso') {
  const root = await mkdtemp(join(tmpdir(), 'port-re-analysis-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'input.' + extension); await writeFile(sourcePath, bytes);
  return { sourcePath, kind: extension === 'iso' ? 'iso' : 'firmware', dir: join(root, 'project'), id: randomUUID() };
}
test('inventories a PS2 ISO and extracts its actual boot ELF without changing the ISO', async t => {
  const original = makeDisc(), options = await workspace(t, original);
  const report = await analyzeInput(options);
  assert.equal(report.platform, 'PS2'); assert.equal(report.serial, 'SLUS_000.00');
  assert.equal(report.artifacts.length, 1); assert.equal(report.artifacts[0].machine, 8);
  assert.equal(report.originalSourceRecovered, false);
  assert.deepEqual(await readFile(options.sourcePath), original);
  const stored = JSON.parse(await readFile(join(options.dir, 'report.json'), 'utf8'));
  assert.equal(stored.id, options.id); assert.match(reportMarkdown(stored), /integral recuperado: não/);
});
test('a PS3 ISO identifies PARAM.SFO and a readable PowerPC ELF', async t => {
  const report = await analyzeInput(await workspace(t, makeDisc({ ps3: true })));
  assert.equal(report.platform, 'PS3'); assert.equal(report.title, 'Synthetic Console Test');
  assert.equal(report.serial, 'TEST00001'); assert.equal(report.artifacts[0].machine, 21);
});
test('a PS3 SELF remains a non-decompilable container after extraction', async t => {
  const report = await analyzeInput(await workspace(t, makeDisc({ ps3: true, self: true })));
  assert.equal(report.artifacts[0].kind, 'self'); assert.equal(report.artifacts[0].decompilable, false);
});
test('reads a UDF 2.60 image made by an independent filesystem writer', async t => {
  const bytes = gunzipSync(await readFile(new URL('../support/synthetic-ps3-udf.iso.gz', import.meta.url)));
  const report = await analyzeInput(await workspace(t, bytes));
  assert.equal(report.filesystem, 'UDF'); assert.equal(report.platform, 'PS3');
  assert.equal(report.game.TITLE_ID, 'TEST00001'); assert.equal(report.artifacts[0].machine, 21);
});
test('a changed ISO cannot be extracted using an old inventory', async t => {
  const options = await workspace(t, makeDisc());
  const report = await analyzeInput(options);
  await writeFile(options.sourcePath, Buffer.alloc(1024));
  await assert.rejects(appendDiscArtifact({ report, entry: report.files[0], dir: options.dir }), /mudou desde o inventário/);
});
test('firmware report explicitly separates ROM modules from game source', async t => {
  const report = await analyzeInput(await workspace(t, makeFirmware(), 'bin'));
  assert.equal(report.firmware.kind, 'ps2-bios'); assert.equal(report.artifacts.length, 0);
  assert.equal(report.originalSourceRecovered, false); assert.match(reportMarkdown(report), /ROMVER: 0200EC20040614/);
});
test('ISO parser rejects invalid images and unsafe archive paths', async t => {
  const options = await workspace(t, Buffer.alloc(4096));
  await assert.rejects(listDisc(options.sourcePath), /pequena demais/);
  assert.throws(() => parseListing('Path = ../../danger\nSize = 4\n\n'), /inseguro/);
  assert.throws(() => parseListing('Path = C:\\danger\nSize = 4\n\n'), /inseguro/);
});
test('extraction does not delete an existing destination on failure', async t => {
  const options = await workspace(t, makeDisc());
  const { files } = await listDisc(options.sourcePath);
  const destination = join(options.dir, '..', 'keep.bin'); await writeFile(destination, 'preserve me');
  await assert.rejects(extractEntry(options.sourcePath, files[0], destination));
  assert.equal(await readFile(destination, 'utf8'), 'preserve me');
});
test('SFO reader rejects values pointing outside the file', () => {
  const sfo = makeSfo(); assert.equal(parseSfo(sfo).TITLE_ID, 'TEST00001');
  sfo.writeUInt32LE(0xFFFFFFF0, 12); assert.throws(() => parseSfo(sfo), /inválid/);
});
