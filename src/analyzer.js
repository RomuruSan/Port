import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { inspectBinary, inspectFirmware, summarizeFile, AnalysisError } from './binary.js';
import { extractEntry, listDisc } from './archive.js';

export const LIMITATIONS = [
  'Decompilação produz uma aproximação da lógica; não recupera todos os arquivos-fonte, nomes, comentários, macros ou informações removidas pelo compilador.',
  'Uma BIOS contém firmware do console, não o código-fonte dos jogos. Analisá-la não transforma uma ISO em código-fonte original.',
  'ISO pode conter texturas, áudio, scripts e contêineres além de executáveis. Inventariar esses arquivos não equivale a decompilar todo o jogo.',
  'MMI/VU do PS2, SPU do PS3, código carregado dinamicamente e contêineres SELF exigem suporte e investigação específicos. O aplicativo não descriptografa conteúdo.',
];
export const safeName = name => basename(name.replaceAll('\\', '/')).replace(/[^A-Za-z0-9_.-]/g, '_').slice(-100) || 'arquivo.bin';

export function parseSfo(buffer) {
  if (buffer.length < 20 || buffer.toString('hex', 0, 4) !== '00505346') throw new AnalysisError('PARAM.SFO inválido.');
  const keys = buffer.readUInt32LE(8), values = buffer.readUInt32LE(12), count = buffer.readUInt32LE(16);
  if (count > 1024 || 20 + count * 16 > buffer.length || keys >= buffer.length || values > buffer.length) throw new AnalysisError('Tabelas de PARAM.SFO inválidas.');
  const result = {};
  for (let i = 0; i < count; i++) {
    const row = 20 + i * 16;
    const keyStart = keys + buffer.readUInt16LE(row), length = buffer.readUInt32LE(row + 4), dataStart = values + buffer.readUInt32LE(row + 12);
    const end = buffer.indexOf(0, keyStart);
    if (keyStart >= buffer.length || end < 0 || dataStart + length > buffer.length || length > 16384) throw new AnalysisError('Campo PARAM.SFO fora do arquivo.');
    const name = buffer.toString('utf8', keyStart, end);
    if (['TITLE', 'TITLE_ID', 'VERSION', 'APP_VER', 'PS3_SYSTEM_VER', 'CATEGORY'].includes(name)) result[name] = buffer.toString('utf8', dataStart, dataStart + length).replace(/\0.*$/, '');
  }
  return result;
}

export async function analyzeArtifact({ sourcePath, name, dir, id = randomUUID(), signal, onProgress = () => {} }) {
  const metadata = await inspectBinary(sourcePath);
  onProgress({ stage: 'binary', message: `Lendo ${name}`, ratio: 0 });
  const summary = await summarizeFile(sourcePath, { signal, onProgress: read => onProgress({ stage: 'binary', message: `Hash e strings: ${name}`, ratio: metadata.sizeBytes ? read / metadata.sizeBytes : 1 }) });
  return { id, name, relativePath: sourcePath.startsWith(`${dir}/`) || sourcePath.startsWith(`${dir}\\`) ? sourcePath.slice(dir.length + 1).replaceAll('\\', '/') : null, sourcePath, ...metadata, ...summary };
}

export async function analyzeInput({ sourcePath, kind, dir, id, signal, onProgress = () => {} }) {
  await mkdir(dir, { recursive: true });
  const original = await stat(sourcePath), size = original.size;
  const report = { schema: 1, app: 'Port RE', version: '0.3.0', id, createdAt: new Date().toISOString(), kind, title: basename(sourcePath), source: { name: basename(sourcePath), path: sourcePath, sizeBytes: size, modifiedAtMs: original.mtimeMs }, artifacts: [], files: [], limitations: LIMITATIONS, originalSourceRecovered: false, status: 'analyzed' };
  if (kind === 'iso') {
    onProgress({ stage: 'inventory', message: 'Lendo o sistema de arquivos ISO/UDF…' });
    const inventory = await listDisc(sourcePath, { signal });
    report.files = inventory.files;
    report.filesystem = inventory.filesystem;
    const system = report.files.find(f => f.path.toUpperCase() === 'SYSTEM.CNF');
    const eboot = report.files.find(f => f.path.toUpperCase() === 'PS3_GAME/USRDIR/EBOOT.BIN');
    let primary;
    if (system && system.sizeBytes <= 64 * 1024) {
      const path = join(dir, 'evidence', 'SYSTEM.CNF');
      await extractEntry(sourcePath, system, path, { signal });
      const config = await readFile(path, 'ascii');
      const boot = /^\s*BOOT2\s*=\s*cdrom0:\\?([^\r\n]+?)\s*$/im.exec(config)?.[1]?.replace(/;\d+$/, '').replaceAll('\\', '/').replace(/^\/+/, '');
      if (boot) {
        report.platform = 'PS2'; report.serial = basename(boot); report.title = `PS2 · ${report.serial}`;
        primary = report.files.find(f => f.path.toUpperCase() === boot.toUpperCase());
      }
    }
    if (eboot) {
      report.platform = 'PS3'; primary = eboot;
      const sfo = report.files.find(f => f.path.toUpperCase() === 'PS3_GAME/PARAM.SFO');
      if (sfo && sfo.sizeBytes <= 1024 * 1024) {
        const path = join(dir, 'evidence', 'PARAM.SFO');
        await extractEntry(sourcePath, sfo, path, { signal });
        try { report.game = parseSfo(await readFile(path)); report.title = report.game.TITLE || 'Jogo PS3'; report.serial = report.game.TITLE_ID || ''; }
        catch (error) { report.warnings = [error.message]; }
      }
    }
    report.platform ||= 'Não identificada';
    if (primary) await appendDiscArtifact({ report, entry: primary, dir, signal, onProgress });
    else report.warnings = [...(report.warnings || []), 'Não foi identificado um executável principal. Selecione um candidato no inventário para extrair e analisar.'];
    report.source.hashScope = 'A ISO não foi inteira hasheada. Os hashes são dos executáveis extraídos.';
  } else if (kind === 'firmware') {
    report.firmware = await inspectFirmware(sourcePath);
    report.platform = report.firmware.platform;
    const summary = await summarizeFile(sourcePath, { signal, onProgress: read => onProgress({ stage: 'firmware', message: 'Inspecionando firmware e strings…', ratio: size ? read / size : 1 }) });
    Object.assign(report.firmware, summary);
  } else {
    const artifact = await analyzeArtifact({ sourcePath, name: basename(sourcePath), dir, signal, onProgress });
    report.artifacts.push(artifact); report.platform = artifact.platform;
  }
  await saveReport(dir, report);
  return report;
}

export async function appendDiscArtifact({ report, entry, dir, signal, onProgress = () => {} }) {
  const current = await stat(report.source.path);
  if (current.size !== report.source.sizeBytes || current.mtimeMs !== report.source.modifiedAtMs) throw new AnalysisError('A imagem mudou desde o inventário. Analise a ISO novamente antes de extrair.');
  const previous = report.artifacts.find(a => a.discEntryId === entry.id);
  if (previous) return previous;
  if (report.artifacts.length >= 1000) throw new AnalysisError('O projeto atingiu o limite de 1.000 arquivos de código analisados.');
  const id = randomUUID();
  const path = join(dir, 'artifacts', `${id}-${safeName(entry.path)}`);
  onProgress({ stage: 'extracting', message: `Extraindo somente ${entry.path}…` });
  await extractEntry(report.source.path, entry, path, { signal });
  const artifact = await analyzeArtifact({ sourcePath: path, name: entry.path, dir, id, signal, onProgress });
  artifact.discEntryId = entry.id;
  report.artifacts.push(artifact);
  return artifact;
}

export async function saveReport(dir, report) {
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
}

export function reportMarkdown(report) {
  const lines = [`# Port RE — ${report.title}`, '', `Data: ${report.createdAt}`, `Plataforma: ${report.platform}`, '', '## Limites da análise', '', ...report.limitations.map(text => `- ${text}`), '', 'Código-fonte original integral recuperado: não.', '', '## Executáveis analisados', ''];
  for (const item of report.artifacts) lines.push(`### ${item.name}`, '', `Formato: ${item.kind}`, `Arquitetura: ${item.architecture}`, `SHA-256: ${item.sha256}`, `Entrada: ${item.entrypoint || 'não aplicável'}`, `Símbolos nomeados listados: ${item.symbols?.length || 0}`, `Strings listadas: ${item.strings.length}`, '', ...(item.warnings || []).map(w => `- ${w}`), '', item.decompilation ? `Ghidra: ${item.decompilation.decompiled} funções decompiladas; ${item.decompilation.failed} falhas; ${item.decompilation.discovered} descobertas. Limite de exportação atingido: ${Boolean(item.decompilation.limited)}.` : 'Decompilação ainda não executada.', '');
  if (report.firmware) lines.push('## Firmware', '', `Identificação: ${report.firmware.kind}`, `ROMVER: ${report.firmware.romVersion || 'não identificado'}`, `SHA-256: ${report.firmware.sha256}`, '', ...report.firmware.warnings.map(w => `- ${w}`));
  lines.push('', '## Inventário do disco', '', `Arquivos identificados: ${report.files.length}. A análise de um executável não representa a decompilação de todos esses arquivos.`, '');
  return lines.join('\n');
}
