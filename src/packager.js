import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { profile } from './profile.js';

export async function engineStatus(engineDir) {
  const executable = join(engineDir, process.platform === 'win32' ? 'openhuey.exe' : 'openhuey');
  try {
    await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    await access(join(engineDir, 'scripts', 'prelude.fs'));
    return { available: true, name: profile.engine, executable, directory: engineDir, host: process.platform, version: (await readFile(join(engineDir, 'engine.json'), 'utf8').then(JSON.parse).catch(() => ({}))).version || 'externa' };
  } catch {
    return { available: false, name: profile.engine, directory: engineDir, host: process.platform };
  }
}

async function copyRuntime(engine, destination) {
  await mkdir(destination, { recursive: true });
  // Only the engine's distribution. Never copy another player's library, saves or disc.
  const names = new Set(['openhuey', 'openhuey.exe', 'scripts', 'lib', 'licences', 'docs', 'mod-examples', 'engine.json', 'README.txt', 'LICENSE']);
  for (const item of await readdir(engine.directory, { withFileTypes: true })) {
    if (names.has(item.name) || /^[A-Za-z0-9_.+-]+\.dll$/i.test(item.name)) {
      await cp(join(engine.directory, item.name), join(destination, item.name), { recursive: true, dereference: true });
    }
  }
}

export async function prepareNativeGame({ engine, isoPath, outputDir, source, signal, onStage = () => {}, onLog = () => {} }) {
  const staging = `${outputDir}.building`;
  await mkdir(resolve(outputDir, '..'), { recursive: true });
  try {
    await access(outputDir);
    throw new Error('A pasta de destino já existe. Escolha uma nova pasta para preservar seus arquivos.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Each output gets a new UUID. A pre-existing folder is always an error, never replaced.
  await mkdir(staging);
  try {
    await onStage('copying');
    await copyRuntime(engine, staging);
    await onStage('importing');
    const executable = join(staging, process.platform === 'win32' ? 'openhuey.exe' : 'openhuey');
    await new Promise((resolveProcess, reject) => {
      let processError;
      const child = spawn(executable, ['--hidden', '--import', isoPath], {
        cwd: staging,
        env: { ...process.env, OPENHUEY_HOME: staging },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        signal,
        timeout: 2 * 60 * 60 * 1000,
      });
      child.stdout.on('data', chunk => onLog(chunk.toString('utf8')));
      child.stderr.on('data', chunk => onLog(chunk.toString('utf8')));
      child.once('error', error => { processError = error; });
      child.once('close', (code, killedBy) => {
        if (processError) reject(processError);
        else if (code === 0) resolveProcess();
        else reject(new Error(`O OpenHuey não concluiu a importação (${killedBy || `código ${code}`}). Consulte o registro abaixo.`));
      });
    });
    const manifest = await readFile(join(staging, 'library', 'manifest.txt'), 'utf8');
    if (!manifest.startsWith('hga-library 1\n') || !/^disc a295af2b$/im.test(manifest)) {
      throw new Error('O motor terminou sem uma biblioteca válida de Haunting Ground.');
    }
    await access(join(staging, 'library', 'data'));
    await writeFile(join(staging, 'port-project.json'), JSON.stringify({
      format: 1, title: profile.title, profile: profile.id,
      createdAt: new Date().toISOString(), target: `${process.platform}-${process.arch}`,
      engine: { name: profile.engine, upstream: profile.upstream, version: engine.version },
      source: { fileName: source.fileName, sha256: source.sha256, serial: source.serial, executable: source.executable },
      status: 'imported', gameplayVerified: false,
    }, null, 2));
    await rename(staging, outputDir);
    return { outputDir, executable: join(outputDir, process.platform === 'win32' ? 'openhuey.exe' : 'openhuey') };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
