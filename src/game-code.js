import { randomUUID } from 'node:crypto';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeArtifact, safeName, saveReport } from './analyzer.js';
import { extractEntry } from './archive.js';
import { AnalysisError } from './binary.js';
import { decompileArtifact } from './ghidra.js';

export const SCAN_LIMITS = Object.freeze({ fileBytes: 512 * 1024 ** 2, runBytes: 8 * 1024 ** 3, artifacts: 1000 });
const signature = bytes => ['7f454c46', '53434500', '7f504b47'].includes(bytes.toString('hex'));

// Scan whole files, not only file names. Containers and embedded/overlaid code need separate analysis.
export async function discoverGameCode({ report, dir, signal, onProgress = () => {} }) {
  if (report.kind === 'firmware') throw new AnalysisError('A BIOS contém firmware. Abra a ISO ou um executável do jogo para buscar código do jogo.');
  const scan = report.codeScan ||= { entries: [], limits: SCAN_LIMITS, method: 'Assinatura ELF/SELF/PKG no início de cada arquivo ISO/UDF; candidatos por nome também são preservados.', scope: 'Não abre contêineres internos, scripts proprietários, regiões criptografadas ou código embutido em outros offsets.' };
  delete scan.error;
  scan.status = 'running'; scan.startedAt = new Date().toISOString();
  let bytesRead = 0;
  try {
    if (report.kind !== 'iso') return;
    const checkSource = async () => {
      const current = await stat(report.source.path);
      if (current.size !== report.source.sizeBytes || current.mtimeMs !== report.source.modifiedAtMs) throw new AnalysisError('A imagem mudou desde o inventário. Analise a ISO novamente.');
    };
    await checkSource();
    const records = new Map(scan.entries.map(row => [row.entryId, row]));
    // Named candidates first, then all other files, including extensionless binaries.
    const files = [...report.files].sort((a, b) => Number(b.executableCandidate) - Number(a.executableCandidate));
    for (const [index, entry] of files.entries()) {
      signal?.throwIfAborted();
      await checkSource();
      let row = records.get(entry.id);
      if (!row) { row = { entryId: entry.id, path: entry.path }; scan.entries.push(row); }
      const existing = report.artifacts.find(a => a.discEntryId === entry.id);
      if (existing) { row.status = 'analyzed'; row.artifactId = existing.id; continue; }
      if (row.status === 'no-signature') continue;
      row.error = undefined;
      if (entry.encrypted) { row.status = 'skipped-encrypted'; continue; }
      if (entry.sizeBytes > SCAN_LIMITS.fileBytes) { row.status = 'skipped-size'; continue; }
      if (bytesRead + entry.sizeBytes > SCAN_LIMITS.runBytes) { row.status = 'skipped-budget'; continue; }
      if (report.artifacts.length >= SCAN_LIMITS.artifacts) { row.status = 'skipped-artifact-limit'; continue; }
      bytesRead += entry.sizeBytes;
      const id = randomUUID(), path = join(dir, 'artifacts', `${id}-${safeName(entry.path)}`);
      onProgress({ stage: 'scan', message: `Verificando assinatura ${index + 1}/${files.length}: ${entry.path}`, ratio: index / files.length });
      let keep = false, created = false;
      try {
        await extractEntry(report.source.path, entry, path, { signal });
        created = true;
        const file = await open(path, 'r');
        const header = Buffer.alloc(4);
        try { await file.read(header, 0, 4, 0); } finally { await file.close(); }
        if (!signature(header) && !entry.executableCandidate) { row.status = 'no-signature'; continue; }
        const artifact = await analyzeArtifact({ sourcePath: path, name: entry.path, dir, id, signal, onProgress });
        artifact.discEntryId = entry.id; artifact.discovery = signature(header) ? 'signature' : 'filename';
        report.artifacts.push(artifact); keep = true;
        row.status = 'analyzed'; row.artifactId = id;
      } catch (error) {
        row.status = signal?.aborted ? 'cancelled' : 'failed'; row.error = error.message;
        if (signal?.aborted) throw error;
      } finally {
        if (created && !keep) await rm(path, { force: true });
      }
      if (index % 10 === 0 || keep) await saveReport(dir, report);
    }
    await checkSource();
  } catch (error) {
    scan.error = error.message;
    scan.status = signal?.aborted ? 'cancelled' : 'failed';
    throw error;
  } finally {
    scan.bytesReadThisRun = bytesRead;
    scan.finishedAt = new Date().toISOString();
    if (scan.status === 'running') scan.status = 'finished';
    await saveReport(dir, report);
  }
}

export async function decompileGameCode({ report, dir, tools, scriptDir, maxFunctions = 0, signal, onProgress = () => {}, decompile = decompileArtifact }) {
  if (!tools.ready) throw new AnalysisError('Configure Ghidra e Java em Ferramentas antes de buscar e decompilar o código.');
  await mkdir(dir, { recursive: true });
  report.version = '0.3.0';
  report.codeRun = { status: 'running', startedAt: new Date().toISOString(), maxFunctions };
  try {
    await discoverGameCode({ report, dir, signal, onProgress });
    for (const [index, artifact] of report.artifacts.entries()) {
      signal?.throwIfAborted();
      if (!artifact.decompilable) { artifact.codeStatus = 'unsupported'; continue; }
      const previous = artifact.decompilation;
      if (previous && !previous.limited && previous.failed === 0 && previous.requestedLimit === maxFunctions) { artifact.codeStatus = 'exported'; continue; }
      const outputDir = join(dir, 'ghidra', randomUUID());
      let log = '';
      try {
        onProgress({ stage: 'decompiling', message: `Executável ${index + 1}/${report.artifacts.length}: ${artifact.name}` });
        const { functions, ...summary } = await decompile({ artifact, tools, outputDir, scriptDir, maxFunctions, signal, onLog: message => {
          log = (log + message).slice(-100000);
          onProgress({ stage: 'decompiling', message: `Ghidra ${index + 1}/${report.artifacts.length}: ${artifact.name}`, log });
        } });
        artifact.decompilation = summary; artifact.decompilationLog = log;
        artifact.codeStatus = summary.limited || summary.failed ? 'partial' : 'exported';
        delete artifact.decompilationFailure;
      } catch (error) {
        artifact.codeStatus = signal?.aborted ? 'cancelled' : 'failed';
        artifact.decompilationFailure = { error: error.message, outputDir, log };
        if (signal?.aborted) throw error;
      }
      await saveReport(dir, report);
    }
    report.codeRun.status = 'finished';
  } catch (error) {
    report.codeRun.status = signal?.aborted ? 'cancelled' : 'failed';
    report.codeRun.error = error.message;
    throw error;
  } finally {
    report.codeRun.finishedAt = new Date().toISOString();
    await saveReport(dir, report);
  }
  return report;
}

export function codeCoverage(report) {
  const all = report.artifacts || [], entries = report.codeScan?.entries || [];
  const checked = new Set(entries.filter(r => ['analyzed', 'no-signature'].includes(r.status)).map(r => r.entryId));
  const sum = key => all.reduce((n, a) => n + (a.decompilation?.[key] || 0), 0);
  return {
    originalSourceRecovered: false, nativePortReady: false,
    scanStatus: report.codeScan?.status || 'not-run', runStatus: report.codeRun?.status || 'not-run',
    discFiles: report.files.length, checkedFiles: entries.filter(r => ['analyzed', 'no-signature'].includes(r.status)).length,
    pendingFiles: report.files.filter(f => !checked.has(f.id)).length,
    artifacts: all.length, unsupportedArtifacts: all.filter(a => !a.decompilable).length,
    failedArtifacts: all.filter(a => ['failed', 'cancelled'].includes(a.codeStatus)).length,
    unprocessedArtifacts: all.filter(a => a.decompilable && !a.decompilation).length,
    discoveredFunctions: sum('discovered'), attemptedFunctions: sum('attempted'), decompiledFunctions: sum('decompiled'), failedFunctions: sum('failed'),
    notExportedFunctions: Math.max(0, sum('discovered') - sum('attempted')),
    limitedArtifacts: all.filter(a => a.decompilation?.limited).length,
    warningFunctions: sum('warningFunctions'), assemblyLimitedArtifacts: all.filter(a => a.decompilation?.assemblyLimited).length,
    scope: report.codeScan?.scope || 'Varredura por assinatura ainda não realizada. A autoanálise não comprova a descoberta de todo o código.',
  };
}
