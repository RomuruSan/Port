import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { downloadVerified } from '../src/toolchain.js';
import { decompileArtifact } from '../src/ghidra.js';

test('download uses the expected SHA-256 and rejects modified content', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'port-re-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('synthetic verified payload');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const fetcher = async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
  await downloadVerified('https://example.invalid/fixture', join(directory, 'verified'), checksum, { fetcher });
  assert.deepEqual(await readFile(join(directory, 'verified')), bytes);
  await assert.rejects(downloadVerified('https://example.invalid/fixture', join(directory, 'verified'), checksum, { fetcher }), { code: 'EEXIST' });
  assert.deepEqual(await readFile(join(directory, 'verified')), bytes);
  await assert.rejects(downloadVerified('https://example.invalid/fixture', join(directory, 'invalid'), '0'.repeat(64), { fetcher }), /SHA-256 não confere/);
  assert.deepEqual(await readdir(directory), ['verified']);
});
test('Ghidra integration refuses SELF, raw BIOS and missing tools before execution', async () => {
  await assert.rejects(decompileArtifact({ artifact: { kind: 'self', decompilable: false } }), /ELF acessível/);
  await assert.rejects(decompileArtifact({ artifact: { kind: 'raw', decompilable: false } }), /ELF acessível/);
  await assert.rejects(decompileArtifact({ artifact: { kind: 'elf', decompilable: true }, tools: { ready: false } }), /Configure/);
});
