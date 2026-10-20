import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import extract from 'extract-zip';

export const COMPONENTS = Object.freeze({
  ghidra: { name: 'Ghidra 12.1.4', folder: 'ghidra-12.1.4', url: 'https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip', sha256: 'ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db', probe: 'Ghidra/Framework/Utility/lib/Utility.jar' },
  java: { name: 'Temurin JDK 21.0.12.1', folder: 'java-21', url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip', sha256: 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e', probe: 'bin/java.exe' },
});

export async function downloadVerified(url, destination, expected, { fetcher = fetch, signal, onProgress = () => {} } = {}) {
  const response = await fetcher(url, { signal });
  if (!response.ok || !response.body) throw new Error(`Download falhou: HTTP ${response.status}.`);
  const total = Number(response.headers.get('content-length')) || null;
  if (total && total > 1024 ** 3) throw new Error('Download maior que o limite de 1 GiB por componente.');
  const hash = createHash('sha256'); let downloaded = 0, created = false;
  const output = createWriteStream(destination, { flags: 'wx' });
  output.once('open', () => { created = true; });
  try {
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _, callback) {
      downloaded += chunk.length;
      if (downloaded > 1024 ** 3) return callback(new Error('Download ultrapassou 1 GiB.'));
      hash.update(chunk); onProgress({ downloaded, total }); callback(null, chunk);
    } }), output, { signal });
    if (hash.digest('hex') !== expected) throw new Error('O SHA-256 não confere com o valor oficial fixado. O arquivo foi descartado e não será executado.');
  } catch (error) { if (created) await rm(destination, { force: true }); throw error; }
}

export async function installComponent(component, root, options = {}) {
  await mkdir(root, { recursive: true });
  const destination = join(root, component.folder);
  try { await access(join(destination, component.probe)); return destination; } catch { /* New installations are staged separately. */ }
  const staging = join(root, `.install-${randomUUID()}`);
  await mkdir(staging);
  try {
    const archive = join(staging, 'component.zip');
    await downloadVerified(component.url, archive, component.sha256, options);
    const content = join(staging, 'content');
    options.onProgress?.({ phase: 'extracting' });
    let uncompressed = 0;
    await extract(archive, { dir: content, onEntry(entry) { uncompressed += entry.uncompressedSize; if (uncompressed > 2 * 1024 ** 3) throw new Error('O pacote expandido ultrapassa 2 GiB.'); } });
    options.signal?.throwIfAborted();
    const roots = (await readdir(content, { withFileTypes: true })).filter(item => item.isDirectory());
    if (roots.length !== 1) throw new Error('Estrutura inesperada na distribuição oficial.');
    const extracted = join(content, roots[0].name);
    await access(join(extracted, component.probe));
    // Never overwrite an existing, incomplete or user-modified installation.
    try { await access(destination); throw new Error('Já existe uma pasta de ferramenta neste destino. Ela foi preservada; selecione uma instalação manual.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(extracted, destination);
    return destination;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function installWindowsTools(root, { fetcher = fetch, signal, onProgress = () => {} } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('A instalação automática de ferramentas é para Windows x64. Neste sistema, configure Ghidra e JDK manualmente.');
  const result = {};
  for (const key of ['ghidra', 'java']) {
    const component = COMPONENTS[key];
    onProgress({ stage: 'download', message: `Preparando ${component.name}…` });
    result[key] = await installComponent(component, root, { fetcher, signal, onProgress: progress => onProgress({ stage: progress.phase || 'download', message: progress.phase === 'extracting' ? `SHA-256 confirmado. Extraindo ${component.name}…` : `Baixando ${component.name} com verificação SHA-256…`, ...progress }) });
  }
  return { ghidraDir: result.ghidra, javaHome: result.java };
}
