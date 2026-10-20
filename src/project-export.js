import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { safeName, reportMarkdown } from './analyzer.js';
import { AnalysisError } from './binary.js';
import { codeCoverage } from './game-code.js';

const within = (root, path) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };

export function portingGuide(report) {
  const c = codeCoverage(report);
  return `# Material de análise para um port — ${report.title}\n\nEste pacote reúne os resultados disponíveis. Não contém o código-fonte original integral nem um jogo pronto para compilar no Windows.\n\n## Abra primeiro\n\n1. Leia COBERTURA.md e coverage.json. Há ${c.pendingFiles} arquivos do disco sem verificação concluída, ${c.unsupportedArtifacts} formatos sem suporte e ${c.notExportedFunctions} funções descobertas sem tentativa de exportação.\n2. Consulte report.json e o inventário completo. “no-signature” só significa ausência de ELF/SELF/PKG no início do arquivo; dados, scripts, overlays e código embutido podem exigir análise própria.\n3. Em executables/, cada pasta contém o binário identificado, metadados, strings, símbolos presentes e os resultados Ghidra disponíveis. functions-index.jsonl enumera todas as funções descobertas, inclusive as não exportadas.\n4. Abra o arquivo .gpr da pasta ghidra/project no Ghidra. Ele permite corrigir funções, tipos, referências e instruções não reconhecidas. Mantenha a pasta .rep junto do .gpr.\n\n## Trabalho necessário para Windows 10/11 x64\n\n1. Confirme a versão/região e os hashes dos executáveis. Separe lógica, recursos, bibliotecas e chamadas do sistema.\n2. Revise assembly e pseudocódigo: convenções de chamada, endianness, ponteiros, tipos e extensões MMI/VU/SPU. C gerado pode conter operações específicas e erros.\n3. Reconstrua módulos e interfaces em C/C++ ou outra linguagem. Recupere dependências e implemente código ausente; um binário sem símbolos não revela nomes ou comentários originais.\n4. Substitua APIs do console: renderização GS/RSX, áudio, controles, armazenamento, threads, DMA e temporização por implementações para PC. SDL, Vulkan ou Direct3D são opções que exigem desenvolvimento próprio.\n5. Implemente carregadores dos recursos do jogo e um sistema de build para Windows x64. Os arquivos pseudocode.c são referência para revisão, não fontes diretamente compiláveis.\n6. Valide cada módulo e compare comportamento, gráficos, áudio e desempenho com a versão original. Só então crie o executável e o instalador do port.\n\nA BIOS contém firmware do console e não fornece os arquivos-fonte dos jogos. SELF/PKG e arquivos criptografados não são descriptografados pelo Port RE.\n`;
}

export function coverageMarkdown(report) {
  const c = codeCoverage(report);
  return ['# Cobertura da análise', '', 'Descobrir todas as funções originais: não comprovado. Código-fonte original integral recuperado: não. Port nativo pronto: não.', '',
    ...Object.entries(c).filter(([, v]) => typeof v === 'number' || typeof v === 'string').map(([k, v]) => `- ${k}: ${v}`), '',
    '## Arquivos com pendências', '',
    ...(report.codeScan?.entries || []).filter(r => !['analyzed', 'no-signature'].includes(r.status)).map(r => `- ${r.path}: ${r.status}${r.error ? ' — ' + r.error : ''}`), '',
    '## Executáveis', '', ...report.artifacts.map(a => `- ${a.name}: ${a.codeStatus || (a.decompilation ? 'exportação individual' : 'não decompilado')}${a.decompilationFailure ? ' — ' + a.decompilationFailure.error : ''}`), '',
    '## Limites', '', ...report.limitations.map(s => `- ${s}`), '',
    'A varredura lê até 8 GiB novos por execução, 512 MiB por arquivo e mantém até 1.000 arquivos de código. Execute novamente para continuar arquivos adiados pelo orçamento. Arquivos internos de contêineres não são abertos automaticamente.', '',
    'O exportador Ghidra registra limites, timeouts e falhas. A ausência de falhas não prova que todas as instruções ou funções foram identificadas.', ''].join('\n');
}

export async function exportProject({ report, projectDir, destinationRoot, signal, onProgress = () => {} }) {
  signal?.throwIfAborted();
  const root = await realpath(destinationRoot), project = await realpath(projectDir);
  if (!(await lstat(root)).isDirectory()) throw new AnalysisError('Escolha uma pasta de destino.');
  if (within(project, root)) throw new AnalysisError('Escolha uma pasta fora do projeto interno do aplicativo.');
  const token = randomUUID();
  const folderName = `${safeName(report.title)}-port-${token}`;
  const target = join(root, folderName), staging = join(root, `.port-re-export-${token}`);
  const manifest = [], exported = structuredClone(report);
  exported.exports = undefined;
  let created = false;
  const record = async (path, dest) => {
    signal?.throwIfAborted();
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new AnalysisError('Exportação aceita somente arquivos regulares, sem links simbólicos.');
    await mkdir(join(staging, dest, '..'), { recursive: true });
    const hash = createHash('sha256');
    const targetPath = join(staging, dest);
    await pipeline(createReadStream(path), new Transform({ transform(chunk, _, cb) { hash.update(chunk); cb(null, chunk); } }), createWriteStream(targetPath, { flags: 'wx' }), { signal });
    const sha256 = hash.digest('hex');
    manifest.push({ path: dest.replaceAll('\\', '/'), sizeBytes: info.size, sha256 });
    onProgress({ stage: 'exporting', message: `Salvando ${dest}…` });
    return sha256;
  };
  const internal = async path => {
    const actual = await realpath(path);
    if (!within(project, actual) || (await lstat(path)).isSymbolicLink()) throw new AnalysisError('Resultado fora da pasta interna do projeto.');
    return actual;
  };
  const tree = async (source, dest) => {
    const checked = await internal(source);
    for (const item of await readdir(checked, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const path = join(checked, item.name), out = join(dest, item.name);
      if (item.isSymbolicLink()) throw new AnalysisError('Um resultado contém link simbólico; exportação interrompida.');
      if (item.isDirectory()) await tree(path, out);
      else if (item.isFile()) await record(path, out);
      else throw new AnalysisError('Um resultado não é um arquivo regular.');
    }
  };
  try {
    await mkdir(staging); created = true;
    for (const [index, artifact] of report.artifacts.entries()) {
      const out = join('executables', `${String(index + 1).padStart(4, '0')}-${safeName(artifact.name)}`);
      const source = artifact.relativePath ? await internal(artifact.sourcePath) : artifact.sourcePath;
      const hash = await record(source, join(out, 'binary', safeName(artifact.name)));
      if (artifact.sha256 && artifact.sha256 !== hash) throw new AnalysisError(`O executável ${artifact.name} mudou. Analise novamente antes de exportar.`);
      const portable = exported.artifacts[index];
      portable.sourcePath = join(out, 'binary', safeName(artifact.name)).replaceAll('\\', '/'); portable.relativePath = portable.sourcePath;
      await writeFile(join(staging, out, 'strings.json'), JSON.stringify(artifact.strings, null, 2), { flag: 'wx' });
      await writeFile(join(staging, out, 'symbols.json'), JSON.stringify(artifact.symbols || [], null, 2), { flag: 'wx' });
      if (artifact.decompilation) {
        await tree(artifact.decompilation.outputDir, join(out, 'ghidra'));
        portable.decompilation.outputDir = `${out}/ghidra`.replaceAll('\\', '/');
        portable.decompilation.exportDir = `${out}/ghidra/export`.replaceAll('\\', '/');
      }
      if (artifact.decompilationFailure) {
        try { await tree(artifact.decompilationFailure.outputDir, join(out, 'ghidra-partial')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        portable.decompilationFailure.outputDir = `${out}/ghidra-partial`.replaceAll('\\', '/');
      }
      await writeFile(join(staging, out, 'metadata.json'), JSON.stringify(portable, null, 2), { flag: 'wx' });
    }
    try { await tree(join(project, 'evidence'), 'evidence'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    exported.source.originalPath = exported.source.path; exported.source.path = null;
    const coverage = codeCoverage(report);
    const texts = {
      'report.json': JSON.stringify(exported, null, 2), 'RELATORIO.md': reportMarkdown(report),
      'coverage.json': JSON.stringify(coverage, null, 2), 'COBERTURA.md': coverageMarkdown(report),
      'LEIA-ME-PORT-WINDOWS.md': portingGuide(report), 'inventory.json': JSON.stringify(report.files, null, 2),
    };
    for (const [name, text] of Object.entries(texts)) { signal?.throwIfAborted(); await writeFile(join(staging, name), text, { flag: 'wx' }); }
    // Hash generated metadata too. The manifest itself is intentionally not self-hashed.
    const listed = new Set(manifest.map(row => row.path));
    const indexMetadata = async dir => {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        signal?.throwIfAborted();
        const path = join(dir, item.name);
        if (item.isDirectory()) await indexMetadata(path);
        else {
          const name = relative(staging, path).replaceAll('\\', '/');
          if (!listed.has(name)) {
            const hash = createHash('sha256');
            for await (const chunk of createReadStream(path)) { signal?.throwIfAborted(); hash.update(chunk); }
            manifest.push({ path: name, sizeBytes: (await lstat(path)).size, sha256: hash.digest('hex') });
          }
        }
      }
    };
    await indexMetadata(staging);
    await writeFile(join(staging, 'manifest.json'), JSON.stringify({ schema: 1, app: 'Port RE', version: '0.3.0', exportedAt: new Date().toISOString(), originalSourceRecovered: false, nativePortReady: false, coverage, files: manifest }, null, 2), { flag: 'wx' });
    signal?.throwIfAborted();
    await rename(staging, target);
    return { path: target, files: manifest.length + 1, coverage };
  } catch (error) {
    if (created) await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
