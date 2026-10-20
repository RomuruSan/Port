const { app, BrowserWindow, dialog, ipcMain, shell, net, session } = require('electron');
const { join, resolve, extname, basename, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');

app.setName('Port RE');
if (process.env.PORT_RE_DATA_DIR) {
  require('node:fs').mkdirSync(resolve(process.env.PORT_RE_DATA_DIR), { recursive: true });
  app.setPath('userData', resolve(process.env.PORT_RE_DATA_DIR));
}
const ROOT = join(__dirname, '..');
let win, modules, data, settings = {}, active;
const inputs = new Map(), reports = new Map();
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const jobDir = id => { if (!uuid.test(id)) throw new Error('Projeto inválido.'); return join(data, 'projects', id); };
const getReport = id => { const r = reports.get(id); if (!r) throw new Error('Projeto não encontrado.'); return r; };
const persistSettings = () => fs.writeFile(join(data, 'settings.json'), JSON.stringify(settings, null, 2));
const state = async () => ({ version: app.getVersion(), platform: process.platform, busy: Boolean(active), tools: await modules.ghidra.checkTools(settings), settings: { maxFunctions: settings.maxFunctions ?? 0 }, reports: [...reports.values()].map(r => ({ id: r.id, title: r.title, platform: r.platform, kind: r.kind, createdAt: r.createdAt, status: r.status })).reverse(), dataDirectory: data });

async function task(label, action) {
  if (active) throw new Error('Aguarde ou cancele a operação atual.');
  const current = { controller: new AbortController(), label }; active = current;
  let last = 0, previousStage;
  const progress = payload => {
    const now = Date.now();
    if (now - last < 100 && payload.stage === previousStage && payload.ratio !== 1) return;
    last = now; previousStage = payload.stage;
    win?.webContents.send('task:progress', { label, ...payload });
  };
  current.promise = (async () => {
    try { return await action(current.controller.signal, progress); }
    finally { if (active === current) active = undefined; win?.webContents.send('task:finished'); }
  })();
  return current.promise;
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame?.url !== pathToFileURL(join(ROOT, 'public/index.html')).href) return { ok: false, error: 'Origem não autorizada.' };
    try { return { ok: true, value: await callback(...args) }; }
    catch (error) { return { ok: false, error: error.name === 'AbortError' ? 'Operação cancelada. Arquivos originais preservados.' : error.message }; }
  });
}

async function initialize() {
  const [analyzer, ghidra, toolchain, gameCode, projectExport] = await Promise.all(['analyzer', 'ghidra', 'toolchain', 'game-code', 'project-export'].map(name => import(pathToFileURL(join(ROOT, `src/${name}.js`)).href)));
  modules = { analyzer, ghidra, toolchain, gameCode, projectExport }; data = app.getPath('userData');
  await fs.mkdir(join(data, 'projects'), { recursive: true });
  try { settings = JSON.parse(await fs.readFile(join(data, 'settings.json'), 'utf8')); } catch { settings = {}; }
  for (const item of await fs.readdir(join(data, 'projects'), { withFileTypes: true })) {
    if (!item.isDirectory() || !uuid.test(item.name)) continue;
    try {
      const path = join(jobDir(item.name), 'report.json');
      if ((await fs.stat(path)).size > 96 * 1024 * 1024) continue;
      const report = JSON.parse(await fs.readFile(path, 'utf8'));
      if (report.id === item.name && report.schema === 1) reports.set(report.id, report);
    } catch { /* An incomplete analysis is not presented as completed. */ }
  }
  handle('app:state', state);
  handle('input:choose', async kind => {
    if (!['iso', 'binary', 'firmware'].includes(kind)) throw new Error('Tipo de análise inválido.');
    const filters = kind === 'iso' ? [{ name: 'Imagem de disco', extensions: ['iso', 'img'] }] : [{ name: 'Executável ou firmware', extensions: ['elf', 'bin', 'self', 'sprx', 'irx', 'rom', 'bios', 'img', '*'] }];
    const result = await dialog.showOpenDialog(win, { title: kind === 'firmware' ? 'Selecionar BIOS ou dump de firmware' : 'Selecionar arquivo para análise', properties: ['openFile'], filters });
    if (result.canceled) return null;
    const path = result.filePaths[0], stats = await fs.stat(path);
    if (!stats.isFile()) throw new Error('Selecione um arquivo regular.');
    const input = { id: randomUUID(), path, kind, name: basename(path), sizeBytes: stats.size };
    inputs.set(input.id, input); return input;
  });
  handle('analysis:start', inputId => task('Análise de arquivo', async (signal, onProgress) => {
    const input = inputs.get(inputId);
    if (!input) throw new Error('Selecione um arquivo pelo botão Abrir.');
    if (input.kind !== 'iso' && input.sizeBytes > 512 * 1024 * 1024) throw new Error('Executáveis e dumps individuais têm limite de 512 MiB. A ISO é lida sem carregá-la inteira na memória.');
    const id = randomUUID();
    const report = await analyzer.analyzeInput({ sourcePath: input.path, kind: input.kind, dir: jobDir(id), id, signal, onProgress });
    reports.set(id, report); return report;
  }));
  handle('report:get', id => getReport(id));
  handle('analysis:extract', (id, entryId) => task('Extração de executável', async (signal, onProgress) => {
    const report = getReport(id);
    if (report.kind !== 'iso') throw new Error('Este projeto não é uma imagem de disco.');
    const entry = report.files.find(f => f.id === entryId);
    if (!entry) throw new Error('Arquivo não encontrado no inventário.');
    await analyzer.appendDiscArtifact({ report, entry, dir: jobDir(id), signal, onProgress });
    await analyzer.saveReport(jobDir(id), report); return report;
  }));
  handle('analysis:decompile', (id, artifactId) => task('Decompilação Ghidra', async (signal, onProgress) => {
    const report = getReport(id), artifact = report.artifacts.find(a => a.id === artifactId);
    if (!artifact) throw new Error('Executável não encontrado.');
    const tools = await ghidra.checkTools(settings); let log = '';
    const scriptDir = join(ROOT.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1'), 'ghidra_scripts');
    const result = await ghidra.decompileArtifact({ artifact, tools, outputDir: join(jobDir(id), 'ghidra', randomUUID()), scriptDir, maxFunctions: settings.maxFunctions ?? 0, signal, onLog: message => {
      log = (log + message).slice(-100000); onProgress({ stage: 'decompiling', message: 'Ghidra: autoanálise e exportação de pseudocódigo…', log });
    } });
    const { functions, ...summary } = result;
    artifact.decompilation = summary; artifact.decompilationLog = log;
    artifact.codeStatus = summary.limited || summary.failed ? 'partial' : 'exported'; delete artifact.decompilationFailure;
    await analyzer.saveReport(jobDir(id), report); return report;
  }));
  handle('analysis:functions', async (id, artifactId) => {
    const report = getReport(id), artifact = report.artifacts.find(a => a.id === artifactId);
    if (!artifact?.decompilation) return [];
    const directory = resolve(artifact.decompilation.exportDir);
    if (!directory.startsWith(`${resolve(jobDir(id))}${sep}`)) throw new Error('Pasta de exportação inválida.');
    const file = join(directory, 'functions.json');
    if ((await fs.stat(file)).size > 64 * 1024 * 1024) throw new Error('Abra esta exportação pela pasta do projeto.');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  });
  handle('report:export', async id => {
    const report = getReport(id);
    const result = await dialog.showSaveDialog(win, { title: 'Exportar relatório de análise', defaultPath: join(app.getPath('documents'), `${analyzer.safeName(report.title)}-analise.md`), filters: [{ name: 'Relatório Markdown', extensions: ['md'] }, { name: 'Relatório JSON', extensions: ['json'] }] });
    if (result.canceled) return null;
    let target = result.filePath;
    if (!['.json', '.md'].includes(extname(target).toLowerCase())) target += '.md';
    const normalize = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    if ([report.source.path, ...report.artifacts.map(a => a.sourcePath)].some(path => normalize(path) === normalize(target))) throw new Error('O relatório não pode substituir um arquivo de entrada.');
    await fs.writeFile(target, extname(target).toLowerCase() === '.json' ? JSON.stringify(report, null, 2) : analyzer.reportMarkdown(report)); return target;
  });
  handle('report:folder', async id => { const error = await shell.openPath(jobDir(getReport(id).id)); if (error) throw new Error(error); });
  const exportCode = async (id, runAnalysis) => {
    if (active) throw new Error('Aguarde ou cancele a operação atual.');
    const report = getReport(id);
    if (runAnalysis && report.kind === 'firmware') throw new Error('Abra a ISO ou um executável do jogo. A BIOS contém firmware.');
    const result = await dialog.showOpenDialog(win, { title: 'Escolha onde salvar — será criada uma subpasta nova para os resultados', defaultPath: settings.outputDirectory || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    settings.outputDirectory = result.filePaths[0]; await persistSettings();
    return task(runAnalysis ? 'Busca, decompilação e exportação de código' : 'Exportação dos resultados disponíveis', async (signal, onProgress) => {
      if (runAnalysis) {
        const tools = await ghidra.checkTools(settings);
        const scriptDir = join(ROOT.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1'), 'ghidra_scripts');
        await gameCode.decompileGameCode({ report, dir: jobDir(id), tools, scriptDir, maxFunctions: settings.maxFunctions ?? 0, signal, onProgress });
      }
      const exported = await projectExport.exportProject({ report, projectDir: jobDir(id), destinationRoot: result.filePaths[0], signal, onProgress });
      report.exports = [...(report.exports || []), { path: exported.path, createdAt: new Date().toISOString(), files: exported.files }].slice(-20);
      await analyzer.saveReport(jobDir(id), report);
      return { report, exported };
    });
  };
  handle('code:run', id => exportCode(id, true));
  handle('code:export', id => exportCode(id, false));
  handle('code:coverage', id => gameCode.codeCoverage(getReport(id)));
  handle('code:folder', async id => {
    const path = getReport(id).exports?.at(-1)?.path;
    if (!path) throw new Error('Exporte os resultados para uma pasta primeiro.');
    const error = await shell.openPath(path); if (error) throw new Error(error);
  });
  handle('tools:choose', async key => {
    if (active) throw new Error('Aguarde a operação atual antes de alterar ferramentas.');
    if (!['ghidraDir', 'javaHome'].includes(key)) throw new Error('Ferramenta inválida.');
    const result = await dialog.showOpenDialog(win, { title: key === 'ghidraDir' ? 'Pasta do Ghidra (contém Ghidra e support)' : 'Pasta do JDK (contém bin/java.exe)', properties: ['openDirectory'] });
    if (!result.canceled) { settings[key] = result.filePaths[0]; await persistSettings(); } return state();
  });
  handle('tools:limit', async number => {
    if (active || !Number.isInteger(number) || number < 0 || number > 10000) throw new Error('Use 0 para todas as funções descobertas ou um limite entre 1 e 10.000, sem operação em andamento.');
    settings.maxFunctions = number; await persistSettings(); return state();
  });
  handle('tools:install', () => task('Instalação de ferramentas', async (signal, onProgress) => {
    Object.assign(settings, await toolchain.installWindowsTools(join(data, 'tools'), { fetcher: (...args) => net.fetch(...args), signal, onProgress }));
    await persistSettings(); return state();
  }));
  handle('task:cancel', () => { active?.controller.abort(); });
  handle('help:open', async key => {
    const urls = { guide: 'https://github.com/RomuruSan/Port#readme', ghidra: 'https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.4_build', java: 'https://adoptium.net/temurin/releases/?version=21' };
    if (!urls[key]) throw new Error('Endereço inválido.'); await shell.openExternal(urls[key]);
  });
}

app.whenReady().then(async () => {
  await initialize();
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  win = new BrowserWindow({ width: 1440, height: 960, minWidth: 1000, minHeight: 700, backgroundColor: '#0e1217', title: 'Port RE', icon: join(ROOT, 'public/icon.png'), autoHideMenuBar: true, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  await win.loadFile(join(ROOT, 'public/index.html'));
  if (process.env.PORT_RE_SMOKE_TEST === '1') {
    const archive = await import(pathToFileURL(join(ROOT, 'src/archive.js')).href);
    const processTool = await import(pathToFileURL(join(ROOT, 'src/process.js')).href);
    const sevenZip = await processTool.runProcess(archive.archiveTool(), ['i'], { timeout: 10000 });
    if (!sevenZip.stdout.includes('Udf') || !sevenZip.stdout.includes('Iso')) throw new Error('A distribuição não contém um leitor ISO/UDF utilizável.');
    const result = await win.webContents.executeJavaScript('(async () => { const end=Date.now()+10000; while(document.querySelector("#tool-status")?.textContent === "Verificando ferramentas") { if(Date.now()>end) throw new Error("Renderer initialization timed out"); await new Promise(r=>setTimeout(r,50)); } return {title:document.title,api:typeof window.port?.state,buttons:document.querySelectorAll("button").length,codeExportAvailable:typeof window.port?.runCode === "function" && typeof window.port?.exportCode === "function" && Boolean(document.querySelector("#run-code")) && Boolean(document.querySelector("#export-code")),nodeDisabled:typeof require === "undefined",status:document.querySelector("#tool-status")?.textContent}; })()');
    console.log('PORT_RE_DESKTOP_SMOKE', JSON.stringify(result));
    await fs.writeFile(join(data, 'smoke-result.json'), JSON.stringify({ ...result, archiveFormats: true }, null, 2));
    if (!result.nodeDisabled || result.api !== 'function' || result.buttons < 5 || !result.codeExportAvailable) app.exit(1);
    else if (!process.env.PORT_RE_SMOKE_KEEP_OPEN) app.exit(0);
  }
}).catch(error => { console.error(error); app.exit(1); });
app.on('before-quit', () => active?.controller.abort());
app.on('window-all-closed', () => app.quit());
