import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { inspectBinary, inspectFirmware, summarizeFile } from '../src/binary.js';
import { makeElf } from '../support/elf-fixture.js';
import { makeFirmware } from '../support/disc-fixture.js';

async function file(t, content) {
  const root = await mkdtemp(join(tmpdir(), 'port-re-bin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'test.bin'); await writeFile(path, content); return path;
}
test('reads little-endian ELF32 MIPS segments and entrypoint', async t => {
  const binary = await inspectBinary(await file(t, makeElf()));
  assert.equal(binary.kind, 'elf'); assert.equal(binary.machine, 8);
  assert.equal(binary.bits, 32); assert.equal(binary.endianness, 'little-endian');
  assert.equal(binary.entrypoint, '0x100000'); assert.equal(binary.segments[0].offset, 256);
  assert.equal(binary.decompilable, true); assert.deepEqual(binary.symbols, []);
});
test('reads big-endian ELF64 PowerPC without losing addresses', async t => {
  const binary = await inspectBinary(await file(t, makeElf({ ppc: true })));
  assert.equal(binary.machine, 21); assert.equal(binary.bits, 64);
  assert.equal(binary.endianness, 'big-endian'); assert.equal(binary.segments[0].address, '0x100000');
});
test('refuses truncated tables and out-of-file executable segments', async t => {
  const invalid = makeElf(); invalid.writeUInt32LE(0xFFFFFFFF, 68);
  await assert.rejects(inspectBinary(await file(t, invalid)), /fora do arquivo/);
  await assert.rejects(inspectBinary(await file(t, makeElf().subarray(0, 40))), /ELF inválido/);
});
test('SELF is identified as a container and is never marked decompilable', async t => {
  const binary = await inspectBinary(await file(t, Buffer.from('SCE\0' + '0'.repeat(60))));
  assert.equal(binary.kind, 'self'); assert.equal(binary.decompilable, false);
  assert.match(binary.warnings[0], /não descriptografa/);
});
test('raw data is not mislabeled as a recovered source program', async t => {
  const binary = await inspectBinary(await file(t, Buffer.from('not an executable')));
  assert.equal(binary.kind, 'raw'); assert.equal(binary.decompilable, false);
});
test('firmware inspection validates ROMDIR offsets and reads ROMVER', async t => {
  const firmware = await inspectFirmware(await file(t, makeFirmware()));
  assert.equal(firmware.kind, 'ps2-bios'); assert.equal(firmware.romVersion, '0200EC20040614');
  assert.equal(firmware.entries.length, 3); assert.equal(firmware.decompilable, false);
  assert.match(firmware.warnings[0], /não o código-fonte/);
});
test('a damaged ROMDIR is not accepted as a confirmed PS2 BIOS', async t => {
  const bytes = makeFirmware(); bytes.writeUInt32LE(0xFFFFFFFF, 256 + 12);
  const firmware = await inspectFirmware(await file(t, bytes));
  assert.equal(firmware.kind, 'firmware-unknown');
});
test('streaming hashes the whole file and preserves strings across chunks', async t => {
  const bytes = Buffer.alloc(256 * 1024 + 100);
  bytes.write('a-string-spanning-a-chunk', 256 * 1024 - 10);
  const result = await summarizeFile(await file(t, bytes));
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.strings[0].text, 'a-string-spanning-a-chunk');
  assert.equal(result.bytesHashed, bytes.length);
});
