import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineStatus, prepareNativeGame } from '../src/packager.js';

// This is an importer protocol fixture, never a replacement for the game engine or game tests.
async function fixture(t, program) {
  const dir = await mkdtemp(join(tmpdir(), 'port-packager-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const engineDir = join(dir, 'engine');
  await mkdir(join(engineDir, 'scripts'), { recursive: true });
  await mkdir(join(engineDir, 'user'));
  await writeFile(join(engineDir, 'user', 'private-save'), 'do not package');
  await writeFile(join(engineDir, 'scripts', 'prelude.fs'), 'fixture');
  await writeFile(join(engineDir, 'openhuey'), `#!${process.execPath}\n${program}`);
  await chmod(join(engineDir, 'openhuey'), 0o755);
  const isoPath = join(dir, 'disc image.iso');
  await writeFile(isoPath, 'fixture, not a game');
  return { engine: await engineStatus(engineDir), isoPath, outputDir: join(dir, 'output'), source: { fileName: 'disc image.iso', sha256: 'fixture' } };
}

const unix = { skip: process.platform === 'win32' ? 'The importer process fixture uses a Unix executable; Windows needs its native OpenHuey executable.' : false };

test('packages a successful importer output without user saves or the source image', unix, async t => {
  const settings = await fixture(t, `
const fs = require('node:fs');
const path = require('node:path');
if (process.argv[2] !== '--hidden' || process.argv[3] !== '--import' || !fs.existsSync(process.argv[4])) process.exit(3);
fs.mkdirSync(path.join(process.env.OPENHUEY_HOME, 'library', 'data'), { recursive: true });
fs.writeFileSync(path.join(process.env.OPENHUEY_HOME, 'library', 'manifest.txt'), 'hga-library 1\\ndisc A295AF2B\\n');
`);
  assert.equal(settings.engine.available, true);
  const stages = [];
  const output = await prepareNativeGame({ ...settings, onStage: stage => stages.push(stage) });
  assert.deepEqual(stages, ['copying', 'importing']);
  assert.equal(output.outputDir, settings.outputDir);
  assert.equal((await readFile(settings.isoPath, 'utf8')), 'fixture, not a game');
  assert.equal((await readdir(output.outputDir)).includes('user'), false);
  assert.equal((await readdir(output.outputDir)).includes('source.iso'), false);
  const manifest = JSON.parse(await readFile(join(output.outputDir, 'port-project.json'), 'utf8'));
  assert.equal(manifest.gameplayVerified, false);
});

test('does not publish or retain a partial output after importer failure', unix, async t => {
  const settings = await fixture(t, "process.stderr.write('fixture import failure'); process.exit(4);");
  let log = '';
  await assert.rejects(prepareNativeGame({ ...settings, onLog: message => { log += message; } }), /código 4/);
  assert.match(log, /fixture import failure/);
  await assert.rejects(access(settings.outputDir), { code: 'ENOENT' });
  await assert.rejects(access(`${settings.outputDir}.building`), { code: 'ENOENT' });
});

test('a zero exit code without a valid imported library is a failure', unix, async t => {
  const settings = await fixture(t, 'process.exit(0);');
  await assert.rejects(prepareNativeGame(settings));
  await assert.rejects(access(settings.outputDir), { code: 'ENOENT' });
});

test('preserves an existing output folder', unix, async t => {
  const settings = await fixture(t, 'process.exit(0);');
  await mkdir(settings.outputDir);
  await writeFile(join(settings.outputDir, 'keep.txt'), 'preserved');
  await assert.rejects(prepareNativeGame(settings), /já existe/);
  assert.equal(await readFile(join(settings.outputDir, 'keep.txt'), 'utf8'), 'preserved');
});
