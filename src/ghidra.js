import { access, chmod, mkdir, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from './process.js';
import { AnalysisError, summarizeFile } from './binary.js';

export async function checkTools(settings = {}) {
  const ghidraDir = settings.ghidraDir || process.env.PORT_RE_GHIDRA_DIR || '';
  const javaHome = settings.javaHome || process.env.JAVA_HOME || '';
  const java = javaHome ? join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  let javaInfo = '', javaAvailable = false, ghidraAvailable = false, ghidraVersion = '';
  try {
    const result = await runProcess(java, ['-version'], { timeout: 10000, maxOutput: 32000 });
    javaInfo = (result.stderr || result.stdout).split(/\r?\n/)[0];
    const major = Number(/version "(\d+)/.exec(javaInfo)?.[1]);
    javaAvailable = major >= 21;
  } catch { javaInfo = 'JDK 21 ou mais recente não encontrado'; }
  if (ghidraDir) try {
    await access(join(ghidraDir, 'Ghidra/Framework/Utility/lib/Utility.jar'));
    await access(join(ghidraDir, 'support/LaunchSupport.jar'));
    const properties = await readFile(join(ghidraDir, 'Ghidra/application.properties'), 'utf8');
    ghidraVersion = /^application.version=(.+)$/m.exec(properties)?.[1]?.trim() || '';
    const required = Number(/^application.java.min=(\d+)$/m.exec(properties)?.[1] || 21);
    javaAvailable &&= Number(/version "(\d+)/.exec(javaInfo)?.[1]) >= required;
    ghidraAvailable = true;
  } catch { /* An incomplete or source-only distribution is not a usable tool. */ }
  return { ghidraDir, javaHome, java, javaInfo, javaAvailable, ghidraAvailable, ghidraVersion, ready: javaAvailable && ghidraAvailable };
}

export async function decompileArtifact({ artifact, tools, outputDir, scriptDir, maxFunctions = 0, signal, onLog = () => {} }) {
  if (artifact.kind !== 'elf' || !artifact.decompilable) throw new AnalysisError('A decompilação integrada aceita ELF acessível de MIPS, PowerPC ou SPU; não aceita ISO, BIOS bruta, PKG ou SELF como se fossem código aberto.');
  if (!tools.ready) throw new AnalysisError('Configure uma distribuição Ghidra pronta e um JDK compatível em Ferramentas.');
  if (!Number.isInteger(maxFunctions) || maxFunctions < 0 || maxFunctions > 10000) throw new AnalysisError('Use 0 para tentar todas as funções descobertas ou um limite de 1 a 10.000.');
  if (artifact.sha256 && (await summarizeFile(artifact.sourcePath, { signal, maxStrings: 0 })).sha256 !== artifact.sha256) throw new AnalysisError('O executável mudou desde a análise. Analise a versão atual antes de decompilar.');
  const work = join(outputDir, 'project');
  const exported = join(outputDir, 'export');
  const javaHome = join(outputDir, 'java-user');
  await Promise.all([mkdir(work, { recursive: true }), mkdir(exported, { recursive: true }), mkdir(javaHome, { recursive: true })]);
  if (process.platform !== 'win32') {
    const executable = join(tools.ghidraDir, 'Ghidra/Features/Decompiler/os', process.arch === 'arm64' ? 'linux_arm_64' : 'linux_x86_64', 'decompile');
    try { await access(executable, constants.X_OK); } catch { await chmod(executable, 0o755); }
  }
  // Use Ghidra's own launcher and configured JVM arguments without passing paths through cmd.exe.
  const launch = await runProcess(tools.java, ['-cp', join(tools.ghidraDir, 'support/LaunchSupport.jar'), 'LaunchSupport', tools.ghidraDir, '-vmargs'], { signal, timeout: 15000, maxOutput: 128000 });
  const vmargs = launch.stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('-'));
  const processor = artifact.machine === 8 ? ['-processor', `MIPS:${artifact.endianness === 'little-endian' ? 'LE' : 'BE'}:64:64-32addr`, '-cspec', 'o32'] : artifact.machine === 21 ? ['-processor', `PowerPC:${artifact.endianness === 'little-endian' ? 'LE' : 'BE'}:64:default`] : [];
  const args = [...vmargs, '-Xmx2G', '-XX:ParallelGCThreads=2', '-XX:CICompilerCount=2', '-Djava.awt.headless=true', `-Duser.home=${javaHome}`, '-cp', join(tools.ghidraDir, 'Ghidra/Framework/Utility/lib/Utility.jar'), 'ghidra.Ghidra', 'ghidra.app.util.headless.AnalyzeHeadless', work, 'PortAnalysis', '-import', artifact.sourcePath, ...processor, '-scriptPath', scriptDir, '-postScript', 'PortExport.java', exported, String(maxFunctions), '-analysisTimeoutPerFile', '300', '-max-cpu', '2'];
  await runProcess(tools.java, args, { signal, onLog, timeout: 30 * 60 * 1000, maxOutput: 16 * 1024 * 1024 });
  const summaryFile = join(exported, 'summary.json');
  if ((await stat(summaryFile)).size > 1024 * 1024) throw new AnalysisError('Resumo Ghidra maior que o esperado.');
  const summary = JSON.parse(await readFile(summaryFile, 'utf8'));
  if (summary.originalSourceRecovered !== false || !Number.isInteger(summary.decompiled) || !Number.isInteger(summary.failed)) throw new AnalysisError('O Ghidra não produziu um relatório de exportação válido.');
  if ((await stat(join(exported, 'functions.json'))).size > 64 * 1024 * 1024) throw new AnalysisError('Exportação excedeu o limite de leitura da interface. Abra os arquivos na pasta do projeto.');
  const functions = JSON.parse(await readFile(join(exported, 'functions.json'), 'utf8'));
  return { ...summary, outputDir, exportDir: exported, functions };
}
