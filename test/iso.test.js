import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectIso, IsoError } from '../src/iso.js';
import { compatibility, profile } from '../src/profile.js';
import { makeIso } from '../support/iso-fixture.js';

async function inspect(t, bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'port-iso-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'disc.iso');
  await writeFile(path, bytes);
  return inspectIso(path);
}

test('reads the PS2 boot executable, region and data archive from ISO9660', async t => {
  const disc = await inspect(t, makeIso());
  assert.equal(disc.serial, 'SLUS_210.75');
  assert.equal(disc.region, 'EUA');
  assert.equal(disc.containsGameData, true);
  assert.equal(disc.executable.sizeBytes, 64);
  assert.match(disc.executable.crc32, /^[A-F0-9]{8}$/);
  assert.equal(compatibility(disc).supported, false, 'a fixture must never pass as a real game');
});

test('recognizes a European PS2 serial without marking it compatible', async t => {
  const disc = await inspect(t, makeIso({ serial: 'SLES_000.00' }));
  assert.equal(disc.region, 'Europa');
  assert.equal(compatibility(disc).supported, false);
});

test('rejects a truncated image and invalid endian directory sizes', async t => {
  await assert.rejects(inspect(t, makeIso().subarray(0, 1024)), IsoError);
  const image = makeIso();
  image.writeUInt32BE(1, 16 * 2048 + 156 + 14);
  await assert.rejects(inspect(t, image), /não conferem/);
});

test('rejects non-PS2 boot files and non-MIPS executables', async t => {
  await assert.rejects(inspect(t, makeIso({ boot: false })), /BOOT2/);
  await assert.rejects(inspect(t, makeIso({ machine: 62 })), /ELF32 MIPS/);
});

test('profile accepts only the expected serial, size and CRC32', () => {
  const disc = { serial: profile.serial, executable: { sizeBytes: profile.executableSize, crc32: profile.executableCrc32 } };
  assert.equal(compatibility(disc).supported, true);
  assert.equal(compatibility({ ...disc, executable: { ...disc.executable, crc32: '00000000' } }).supported, false);
  assert.equal(compatibility({ ...disc, serial: 'SLUS_000.00' }).supported, false);
});
