import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { runProcess } from './process.js';
import { AnalysisError } from './binary.js';

const require = createRequire(import.meta.url);
export function archiveTool() {
  // Executables must be outside app.asar; electron-builder unpacks this dependency.
  return require('7zip-bin-full').path7z.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}
async function ensureTool() {
  const path = archiveTool();
  await access(path);
  if (process.platform !== 'win32') await chmod(path, 0o755);
  return path;
}

export function parseListing(text) {
  const files = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const fields = Object.fromEntries(block.split(/\r?\n/).filter(line => line.includes(' = ')).map(line => { const i = line.indexOf(' = '); return [line.slice(0, i), line.slice(i + 3)]; }));
    if (!fields.Path || fields.Folder === '+' || /^D/.test(fields.Attributes || '')) continue;
    const path = fields.Path.replaceAll('\\', '/').replace(/;\d+$/, '');
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => part === '..' || part === '.') || /[\x00-\x1f]/.test(path)) throw new AnalysisError('A imagem contém um caminho de arquivo inseguro.');
    const size = Number(fields.Size);
    if (!Number.isSafeInteger(size) || size < 0) throw new AnalysisError('A imagem contém um tamanho de arquivo inválido.');
    files.push({ id: String(files.length), path, archivePath: fields.Path, sizeBytes: size, encrypted: fields.Encrypted === '+', executableCandidate: /(?:^|\/)(?:EBOOT\.BIN|SL[UEPM][A-Z]_[\d.]+|SC[UEP][A-Z]_[\d.]+)$|\.(?:ELF|SELF|SPRX|IRX)$/i.test(path) });
    if (files.length > 50000) throw new AnalysisError('A imagem ultrapassa o limite de 50.000 arquivos por análise.');
  }
  return files;
}

export async function listDisc(path, { signal, onLog } = {}) {
  const file = await open(path, 'r');
  let signature = '';
  try {
    const { size } = await file.stat();
    if (size < 17 * 2048) throw new AnalysisError('A imagem é pequena demais para um disco ISO/UDF.');
    const buffer = Buffer.alloc(Math.min(size - 16 * 2048, 64 * 2048));
    await file.read(buffer, 0, buffer.length, 16 * 2048);
    const text = buffer.toString('latin1');
    signature = text.includes('BEA01') || text.includes('NSR02') || text.includes('NSR03') ? 'UDF' : text.includes('CD001') ? 'ISO9660' : '';
    if (!signature) throw new AnalysisError('Não foi identificada uma imagem ISO9660/UDF legível. Imagens criptografadas ou outros formatos podem precisar de preparação externa.');
  } finally { await file.close(); }
  const result = await runProcess(await ensureTool(), ['l', '-slt', '-ba', '-sccUTF-8', '--', path], { signal, onLog });
  const files = parseListing(result.stdout);
  if (!files.length) throw new AnalysisError('Nenhum arquivo legível foi encontrado no disco.');
  return { filesystem: signature, files };
}

export async function extractEntry(isoPath, entry, destination, { signal } = {}) {
  if (entry.encrypted) throw new AnalysisError('O arquivo está marcado como criptografado; o aplicativo não solicita chaves nem descriptografa conteúdo.');
  if (entry.sizeBytes > 512 * 1024 * 1024) throw new AnalysisError('A extração individual aceita executáveis de até 512 MiB.');
  await mkdir(dirname(destination), { recursive: true });
  const tool = await ensureTool();
  const child = spawn(tool, ['x', '-so', '-bd', '-y', '-sccUTF-8', '-spd', '--', isoPath, entry.archivePath], { signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let bytes = 0, errorText = '', processError, created = false;
  child.stderr.on('data', data => { errorText = (errorText + data.toString()).slice(-4000); });
  const completed = new Promise((resolve, reject) => {
    child.once('error', error => { processError = error; });
    child.once('close', (code, killedBy) => processError ? reject(processError) : code === 0 ? resolve() : reject(new Error(`A extração falhou: ${killedBy || code}. ${errorText}`)));
  });
  // Handle early failures immediately, even while the stream is still being consumed.
  completed.catch(() => {});
  const output = createWriteStream(destination, { flags: 'wx' });
  output.once('open', () => { created = true; });
  try {
    await pipeline(child.stdout, new Transform({ transform(chunk, _, callback) {
      bytes += chunk.length;
      callback(bytes > entry.sizeBytes ? new AnalysisError('A extração produziu mais dados que o tamanho declarado.') : null, chunk);
    } }), output);
    await completed;
    if (bytes !== entry.sizeBytes || (await stat(destination)).size !== entry.sizeBytes) throw new AnalysisError('A extração não produziu o arquivo completo.');
    return destination;
  } catch (error) {
    child.kill();
    await completed.catch(() => {});
    if (created) await rm(destination, { force: true });
    throw error;
  }
}
