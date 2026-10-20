import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDisc } from '../support/disc-fixture.js';
import { makeElf } from '../support/elf-fixture.js';
import { analyzeInput } from '../src/analyzer.js';
import { codeCoverage, decompileGameCode, discoverGameCode } from '../src/game-code.js';
import { exportProject } from '../src/project-export.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'port-re-code-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, 'game.iso'), dir = join(root, 'project'), destinationRoot = join(root, 'chosen-folder');
  await mkdir(destinationRoot);
  const original = makeDisc({ extraFiles: { 'MODULE.DAT': makeElf({ ppc: true }), 'LOCKED.SELF': Buffer.from('SCE\0' + '0'.repeat(60)), 'TEXT.DAT': Buffer.from('synthetic asset data') } });
  await writeFile(sourcePath, original);
  const report = await analyzeInput({ sourcePath, kind: 'iso', dir, id: randomUUID() });
  return { root, dir, sourcePath, original, destinationRoot, report };
}
async function fakeDecompile({ artifact, outputDir, maxFunctions }) {
  const exportDir = join(outputDir, 'export'); await mkdir(exportDir, { recursive: true });
  for (const [name, text] of Object.entries({ 'pseudocode.c': 'int synthetic(int a) { return a+1; }', 'disassembly.txt': '00100000 add', 'functions.json': '[]', 'functions-index.jsonl': '{"address":"00100000"}\n' })) await writeFile(join(exportDir, name), text);
  const result = { discovered: 1, attempted: 1, decompiled: 1, failed: 0, limited: false, requestedLimit: maxFunctions, originalSourceRecovered: false, outputDir, exportDir, functions: [] };
  await writeFile(join(exportDir, 'summary.json'), JSON.stringify(result));
  return result;
}
test('signature scan finds a hidden ELF, preserves SELF and discards ordinary assets', async t => {
  const f = await fixture(t);
  await discoverGameCode(f);
  assert.equal(f.report.artifacts.length, 3);
  assert.equal(f.report.artifacts.find(a => a.name === 'MODULE.DAT').machine, 21);
  assert.equal(f.report.artifacts.find(a => a.name === 'LOCKED.SELF').decompilable, false);
  assert.equal(f.report.codeScan.entries.find(r => r.path === 'TEXT.DAT').status, 'no-signature');
  assert.equal((await readdir(join(f.dir, 'artifacts'))).length, 3);
  await discoverGameCode(f);
  assert.equal(f.report.artifacts.length, 3); assert.equal(f.report.codeScan.bytesReadThisRun, 0);
  assert.deepEqual(await readFile(f.sourcePath), f.original);
});
test('batch records individual failures, continues other executables, and retries only pending work', async t => {
  const f = await fixture(t); let calls = [];
  const decompile = async opts => { calls.push(opts.artifact.name); if (opts.artifact.machine === 8) throw new Error('synthetic tool failure'); return fakeDecompile(opts); };
  await decompileGameCode({ ...f, tools: { ready: true }, decompile });
  assert.equal(calls.length, 2); assert.equal(f.report.artifacts.find(a => a.machine === 8).codeStatus, 'failed');
  let c = codeCoverage(f.report);
  assert.equal(c.unsupportedArtifacts, 1); assert.equal(c.failedArtifacts, 1); assert.equal(c.decompiledFunctions, 1); assert.equal(c.pendingFiles, 0);
  calls = [];
  await decompileGameCode({ ...f, tools: { ready: true }, decompile: async opts => { calls.push(opts.artifact.name); return fakeDecompile(opts); } });
  assert.deepEqual(calls, ['SLUS_000.00']);
  c = codeCoverage(f.report); assert.equal(c.decompiledFunctions, 2); assert.equal(c.nativePortReady, false);
});
test('cancelled batch persists partial progress and can resume', async t => {
  const f = await fixture(t), controller = new AbortController();
  await assert.rejects(decompileGameCode({ ...f, tools: { ready: true }, signal: controller.signal, decompile: async opts => { controller.abort(); controller.signal.throwIfAborted(); } }), { name: 'AbortError' });
  const saved = JSON.parse(await readFile(join(f.dir, 'report.json'), 'utf8'));
  assert.equal(saved.codeRun.status, 'cancelled'); assert.equal(saved.artifacts[0].codeStatus, 'cancelled');
  await decompileGameCode({ ...f, tools: { ready: true }, decompile: fakeDecompile });
  assert.equal(codeCoverage(f.report).decompiledFunctions, 2);
});
test('scan lists encrypted and oversized files as pending', async t => {
  const f = await fixture(t);
  f.report.files.push({ id: 'encrypted', path: 'SECRET.ELF', sizeBytes: 50, encrypted: true }, { id: 'large', path: 'LARGE.ELF', sizeBytes: 513 * 1024 ** 2 });
  await discoverGameCode(f);
  assert.equal(f.report.codeScan.entries.find(r => r.entryId === 'encrypted').status, 'skipped-encrypted');
  assert.equal(f.report.codeScan.entries.find(r => r.entryId === 'large').status, 'skipped-size');
  assert.equal(codeCoverage(f.report).pendingFiles, 2);
});
test('chosen-folder export includes code, binaries, coverage and hashes without overwriting existing output', async t => {
  const f = await fixture(t);
  await decompileGameCode({ ...f, tools: { ready: true }, decompile: fakeDecompile });
  await writeFile(join(f.destinationRoot, 'keep.txt'), 'keep me');
  const first = await exportProject({ ...f, projectDir: f.dir });
  const second = await exportProject({ ...f, projectDir: f.dir });
  assert.notEqual(first.path, second.path);
  const manifest = JSON.parse(await readFile(join(first.path, 'manifest.json'), 'utf8'));
  assert.equal(manifest.originalSourceRecovered, false); assert.equal(manifest.nativePortReady, false);
  assert.equal(manifest.coverage.decompiledFunctions, 2);
  assert.ok(manifest.files.some(r => r.path.endsWith('pseudocode.c')));
  assert.ok(manifest.files.some(r => r.path.endsWith('functions-index.jsonl')));
  for (const row of manifest.files) {
    const bytes = await readFile(join(first.path, row.path));
    assert.equal(bytes.length, row.sizeBytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
  }
  const exported = JSON.parse(await readFile(join(first.path, 'report.json'), 'utf8'));
  for (const a of exported.artifacts) assert.deepEqual(await readFile(join(first.path, a.sourcePath)), await readFile(f.report.artifacts.find(i => i.id === a.id).sourcePath));
  assert.equal(await readFile(join(f.destinationRoot, 'keep.txt'), 'utf8'), 'keep me');
  assert.deepEqual(await readFile(f.sourcePath), f.original);
});
test('exports reject changed binaries, cancelled operations, internal destinations and symlinked results', async t => {
  const f = await fixture(t);
  await assert.rejects(exportProject({ ...f, projectDir: f.dir, destinationRoot: f.dir }), /fora do projeto/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(exportProject({ ...f, projectDir: f.dir, signal: controller.signal }), { name: 'AbortError' });
  await writeFile(f.report.artifacts[0].sourcePath, 'changed');
  await assert.rejects(exportProject({ ...f, projectDir: f.dir }), /mudou/);
  assert.deepEqual(await readdir(f.destinationRoot), []);
  if (process.platform !== 'win32') {
    const other = await fixture(t);
    await symlink(other.sourcePath, join(other.dir, 'evidence', 'linked'));
    await assert.rejects(exportProject({ ...other, projectDir: other.dir }), /link simbólico/);
    assert.deepEqual(await readdir(other.destinationRoot), []);
  }
});
