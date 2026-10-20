const $ = selector => document.querySelector(selector);
const api = window.port;
let appState, input, report, artifactId, activeTab = 'overview', busy = false;
let functions = [], functionKey = '', selectedFunction = '', currentLog = '';
const size = bytes => bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(2) + ' GiB' : bytes >= 1024 ** 2 ? (bytes / 1024 ** 2).toFixed(1) + ' MiB' : bytes.toLocaleString('pt-BR') + ' B';
const node = (tag, text = '', className = '') => { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; };
const selectedArtifact = () => report?.artifacts.find(a => a.id === artifactId);

function message(text, error = false, selector = '#message') {
  const box = $(selector); box.textContent = text; box.classList.toggle('error', error); box.hidden = !text;
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('.input-card, #analyze, #new-analysis, #choose-ghidra, #choose-java, #save-limit, #history button, #export').forEach(e => { e.disabled = busy; });
  $('#decompile').disabled = busy || !selectedArtifact()?.decompilable || !appState?.tools.ready;
  $('#install-tools').disabled = busy || appState?.platform !== 'win32';
  $('#artifact').disabled = busy;
  if (report) renderFiles();
}
async function refresh() {
  appState = await api.state();
  $('#app-version').textContent = appState.version;
  $('#tool-status').textContent = appState.tools.ready ? 'Ghidra disponível' : 'Decompilador não configurado';
  $('#tools-dot').classList.toggle('ready', appState.tools.ready);
  $('#history-count').textContent = appState.reports.length;
  const history = $('#history');
  history.replaceChildren();
  if (!appState.reports.length) history.append(node('p', 'Nenhuma análise salva.'));
  for (const item of appState.reports.slice(0, 30)) {
    const button = node('button', item.title);
    if (item.id === report?.id) button.classList.add('selected');
    button.append(node('small', (item.platform || 'Arquivo') + ' · ' + new Date(item.createdAt).toLocaleDateString('pt-BR')));
    button.addEventListener('click', async () => {
      try { setReport(await api.report(item.id)); message(''); await refresh(); }
      catch (error) { message(error.message, true); }
    });
    history.append(button);
  }
  $('#ghidra-status').textContent = appState.tools.ghidraAvailable ? 'Distribuição ' + appState.tools.ghidraVersion + ' encontrada' : 'Pasta válida não configurada';
  $('#ghidra-path').textContent = appState.tools.ghidraDir || 'Selecione a pasta que contém Ghidra e support.';
  $('#java-status').textContent = appState.tools.javaAvailable ? 'JDK compatível encontrado' : 'JDK compatível não encontrado';
  $('#java-path').textContent = appState.tools.javaInfo;
  $('#function-limit').value = appState.settings.maxFunctions;
  setBusy(busy);
}
async function operation(label, callback) {
  if (busy) return;
  message(''); message('', false, '#tools-message'); setBusy(true); currentLog = '';
  $('#task').hidden = false; $('#task-title').textContent = label;
  $('#task-message').textContent = 'Preparando operação…'; $('#task-log').textContent = '';
  $('#task-progress').removeAttribute('value'); $('#task-progress').hidden = false;
  $('#task .spinner').hidden = false; $('#cancel').hidden = false;
  let failed = false;
  try { await callback(); }
  catch (error) { failed = true; message(error.message, true); if ($('#tools-dialog').open) message(error.message, true, '#tools-message'); }
  finally {
    $('#task-title').textContent = failed ? 'Operação não concluída' : 'Operação concluída';
    $('#task-message').textContent = failed ? 'Confira o aviso e o registro. Nenhum arquivo original foi alterado.' : 'Os resultados disponíveis foram salvos neste computador.';
    $('#task-progress').hidden = true; $('#task .spinner').hidden = true; $('#cancel').hidden = true;
    setBusy(false); await refresh().catch(error => message(error.message, true));
  }
}
function setReport(value) {
  report = value;
  if (!report.artifacts.some(a => a.id === artifactId)) artifactId = report.artifacts[0]?.id;
  $('#results').hidden = false; $('#initial-empty').hidden = true;
  $('#report-title').textContent = report.title;
  $('#report-subtitle').textContent = (report.platform || 'Arquivo') + ' · ' + size(report.source.sizeBytes) + ' · ' + new Date(report.createdAt).toLocaleString('pt-BR');
  $('#breadcrumb-current').textContent = 'Projeto de análise';
  const select = $('#artifact'); select.replaceChildren();
  for (const artifact of report.artifacts) { const option = node('option', artifact.name); option.value = artifact.id; select.append(option); }
  select.value = artifactId || ''; $('#artifact-bar').hidden = !report.artifacts.length;
  const data = report.firmware;
  const metrics = data ? [[data.entries.length, 'Módulos ROMDIR'], [data.strings.length, 'Strings na amostra'], [size(data.sizeBytes), 'Tamanho do dump'], ['Local', 'Arquivo original preservado']] : [[report.files.length, 'Arquivos no disco'], [report.artifacts.length, 'Executáveis analisados'], [report.artifacts.reduce((n, a) => n + (a.symbols?.length || 0), 0), 'Símbolos nomeados listados'], [report.artifacts.reduce((n, a) => n + (a.decompilation?.decompiled || 0), 0), 'Funções decompiladas']];
  $('#stats').replaceChildren(...metrics.map(([value, label]) => { const box = node('div', '', 'stat'); box.append(node('strong', String(value)), node('small', label)); return box; }));
  renderOverview(); renderFiles(); renderStrings(); loadFunctions(); showTab(activeTab); setBusy(busy);
}
function details(entries) {
  const dl = node('dl', '', 'details-grid');
  for (const [key, value] of entries) { if (value === undefined || value === null || value === '') continue; dl.append(node('dt', key), node('dd', String(value))); }
  return dl;
}
function table(headers, rows) {
  const wrapper = node('div', '', 'table-wrap'), table = document.createElement('table');
  const thead = document.createElement('thead'), tr = document.createElement('tr'); headers.forEach(label => tr.append(node('th', label))); thead.append(tr);
  const tbody = document.createElement('tbody');
  for (const row of rows) { const tr = document.createElement('tr'); for (const value of row) { const td = document.createElement('td'); if (value instanceof Node) td.append(value); else td.textContent = String(value ?? ''); tr.append(td); } tbody.append(tr); }
  table.append(thead, tbody); wrapper.append(table); return wrapper;
}
function warnings(container, values) { for (const value of values) container.append(node('p', value, 'warning-item')); }
function renderOverview() {
  const panel = $('#tab-overview'); panel.replaceChildren();
  const artifact = selectedArtifact(), firmware = report.firmware;
  panel.append(node('h3', 'Origem e identificação'), details([['Arquivo', report.source.name], ['Caminho original', report.source.path], ['Sistema do disco', report.filesystem], ['Identificação', report.serial], ['Hash da ISO', report.source.hashScope]]));
  if (firmware) {
    panel.append(details([['Formato', firmware.kind], ['ROMVER', firmware.romVersion], ['SHA-256', firmware.sha256]]));
    warnings(panel, firmware.warnings);
    if (firmware.entries.length) { panel.append(node('h3', 'Módulos identificados na ROM')); panel.append(table(['Nome', 'Offset', 'Tamanho'], firmware.entries.map(e => [e.name, '0x' + e.offset.toString(16), size(e.size)]))); }
  }
  if (artifact) {
    panel.append(node('h3', 'Executável selecionado'), details([['Formato', artifact.kind.toUpperCase()], ['Processador', artifact.architecture], ['Formato de dados', artifact.bits ? artifact.bits + ' bits · ' + artifact.endianness : ''], ['Entrada', artifact.entrypoint], ['SHA-256', artifact.sha256], ['Segmentos / seções', artifact.segments ? artifact.segments.length + ' / ' + artifact.sections.length : 'Não aplicável']]));
    warnings(panel, artifact.warnings || []);
    if (artifact.decompilation) {
      const d = artifact.decompilation;
      panel.append(node('h3', 'Resultado do Ghidra'), details([['Linguagem do processador', d.language], ['Funções descobertas', d.discovered], ['Exportações tentadas', d.attempted], ['Decompiladas / falhas', d.decompiled + ' / ' + d.failed], ['Funções com avisos', d.warningFunctions || 0], ['Limite atingido', d.limited ? 'Sim; a exportação não cobre todas as funções descobertas.' : 'Não; isso não comprova que todo o código foi descoberto.'], ['Saída', d.exportDir]]));
    }
    if (artifact.symbols?.length) {
      panel.append(node('h3', 'Símbolos presentes no arquivo'));
      panel.append(table(['Nome', 'Endereço', 'Tamanho'], artifact.symbols.slice(0, 300).map(s => [s.name, s.address, s.size])));
      panel.append(node('p', 'Mostrando até 300 símbolos nesta tabela. O relatório contém a amostra completa, limitada a 5.000 entradas de símbolos.', 'list-note'));
    }
  }
  warnings(panel, report.warnings || []);
  panel.append(node('h3', 'O que esta análise não comprova')); warnings(panel, report.limitations);
}
function renderFiles() {
  const box = $('#file-list'); box.replaceChildren();
  if (!report?.files.length) return box.append(node('p', 'Este projeto não contém um inventário de disco.', 'panel-note'));
  const query = $('#file-filter').value.toLowerCase();
  const matches = report.files.filter(f => (!$('#candidates-only').checked || f.executableCandidate) && f.path.toLowerCase().includes(query));
  box.append(table(['Arquivo', 'Tamanho', 'Análise'], matches.slice(0, 500).map(file => {
    const analyzed = report.artifacts.some(a => a.discEntryId === file.id);
    const button = node('button', analyzed ? 'Analisado' : 'Extrair e analisar', 'secondary');
    button.disabled = busy || analyzed || file.encrypted || file.sizeBytes > 512 * 1024 ** 2;
    button.addEventListener('click', () => operation('Extraindo executável', async () => { setReport(await api.extract(report.id, file.id)); }));
    return [file.path, size(file.sizeBytes), button];
  })));
  box.append(node('p', 'Mostrando ' + Math.min(500, matches.length) + ' de ' + matches.length + ' arquivos filtrados. Cada extração individual é limitada a 512 MiB. O inventário completo está no relatório JSON.', 'list-note'));
}
function renderStrings() {
  const box = $('#string-list'); box.replaceChildren();
  const source = report?.firmware || selectedArtifact();
  if (!source?.strings) return box.append(node('p', 'Selecione um executável analisado para ver sua amostra de strings.', 'panel-note'));
  const query = $('#string-filter').value.toLowerCase(), matches = source.strings.filter(s => s.text.toLowerCase().includes(query));
  $('#strings-note').textContent = 'Amostra ASCII · até 3.000 strings';
  box.append(table(['Offset', 'Texto'], matches.slice(0, 500).map(s => [s.offset, s.text])));
  box.append(node('p', 'Mostrando ' + Math.min(500, matches.length) + ' de ' + matches.length + ' resultados. Strings não são código-fonte; textos Unicode e strings fora da amostra podem não aparecer.', 'list-note'));
}
async function loadFunctions() {
  const artifact = selectedArtifact();
  const key = report?.id + '/' + artifact?.id + '/' + artifact?.decompilation?.exportDir;
  if (key === functionKey) return;
  functionKey = key; functions = []; selectedFunction = '';
  $('#code-empty').hidden = Boolean(artifact?.decompilation); $('#code-workspace').hidden = !artifact?.decompilation;
  if (!artifact?.decompilation) return;
  try { const loaded = await api.functions(report.id, artifact.id); if (key !== functionKey) return; functions = loaded; renderFunctions(); }
  catch (error) { message(error.message, true); }
}
function renderFunctions() {
  const query = $('#function-filter').value.toLowerCase();
  const matches = functions.filter(f => f.name.toLowerCase().includes(query));
  const list = $('#functions'); list.replaceChildren();
  for (const f of matches.slice(0, 1000)) {
    const button = node('button', f.name + (f.decompiled ? f.hasWarnings ? ' · avisos' : '' : ' · falhou'));
    button.append(node('small', f.address)); if (f.address === selectedFunction) button.classList.add('selected');
    button.addEventListener('click', () => { selectedFunction = f.address; $('#pseudocode').textContent = f.pseudocode || '// Não foi possível decompilar esta função.\n// ' + (f.error || 'Consulte o Ghidra.'); renderFunctions(); });
    list.append(button);
  }
  list.append(node('p', 'Até 1.000 funções na lista visual. A exportação completa está na pasta do projeto.', 'list-note'));
  if (!selectedFunction && matches.length) { selectedFunction = matches[0].address; $('#pseudocode').textContent = matches[0].pseudocode || '// ' + (matches[0].error || 'Função não decompilada.'); }
  if (!functions.length) $('#pseudocode').textContent = '// Nenhuma função foi exportada. Consulte o registro da operação e o projeto Ghidra.';
}
function showTab(name) {
  activeTab = name;
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  for (const tab of ['overview', 'inventory', 'strings', 'pseudocode']) $('#tab-' + tab).hidden = tab !== name;
}
function openTools() { message('', false, '#tools-message'); $('#tools-dialog').showModal(); }
if (!api) {
  message('Este é um aplicativo de desktop. Abra Port RE pelo atalho instalado; esta página isolada não acessa arquivos nem executa análises.', true);
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
} else {
  document.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', async () => {
    try {
      const selected = await api.choose(button.dataset.kind); if (!selected) return;
      input = selected; $('#selected-input').hidden = false;
      $('#input-name').textContent = input.name; $('#input-path').textContent = input.path; $('#input-size').textContent = size(input.sizeBytes); message('');
    } catch (error) { message(error.message, true); }
  }));
  $('#analyze').addEventListener('click', () => input && operation('Analisando arquivo', async () => { setReport(await api.analyze(input.id)); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $('#decompile').addEventListener('click', () => {
    if (!report || !artifactId) return;
    if ($('#tools-dialog').open) $('#tools-dialog').close();
    operation('Decompilando executável', async () => { setReport(await api.decompile(report.id, artifactId)); showTab('pseudocode'); });
  });
  $('#artifact').addEventListener('change', event => { artifactId = event.target.value; renderOverview(); renderStrings(); loadFunctions(); setBusy(busy); });
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.tab)));
  $('#file-filter').addEventListener('input', renderFiles); $('#candidates-only').addEventListener('change', renderFiles);
  $('#string-filter').addEventListener('input', renderStrings); $('#function-filter').addEventListener('input', renderFunctions);
  $('#new-analysis').addEventListener('click', () => { report = undefined; artifactId = undefined; input = undefined; $('#results').hidden = true; $('#selected-input').hidden = true; $('#initial-empty').hidden = false; $('#breadcrumb-current').textContent = 'Nova análise'; message(''); $('#input-area').scrollIntoView({ behavior: 'smooth' }); refresh(); });
  $('#tools-open').addEventListener('click', openTools); $('#configure-from-code').addEventListener('click', openTools); $('#tools-close').addEventListener('click', () => $('#tools-dialog').close());
  $('#help').addEventListener('click', () => api.help('guide'));
  for (const [selector, key] of [['#choose-ghidra', 'ghidraDir'], ['#choose-java', 'javaHome']]) $(selector).addEventListener('click', async () => { try { await api.chooseTool(key); await refresh(); } catch (error) { message(error.message, true, '#tools-message'); } });
  $('#save-limit').addEventListener('click', async () => { try { await api.limit(Number($('#function-limit').value)); await refresh(); message('Limite de exportação salvo.', false, '#tools-message'); } catch (error) { message(error.message, true, '#tools-message'); } });
  $('#install-tools').addEventListener('click', () => { $('#tools-dialog').close(); operation('Preparando Ghidra e Java', async () => { await api.installTools(); message('Ferramentas instaladas e verificadas. Selecione um ELF para decompilar.'); }); });
  $('#cancel').addEventListener('click', () => api.cancel());
  $('#open-folder').addEventListener('click', async () => { try { if (report) await api.folder(report.id); } catch (error) { message(error.message, true); } });
  $('#export').addEventListener('click', async () => { try { if (report) { const path = await api.export(report.id); if (path) message('Relatório salvo em ' + path); } } catch (error) { message(error.message, true); } });
  api.onProgress(progress => {
    $('#task-message').textContent = progress.message + (progress.downloaded ? ' ' + size(progress.downloaded) + (progress.total ? ' / ' + size(progress.total) : '') : '');
    const ratio = typeof progress.ratio === 'number' ? progress.ratio : progress.total ? progress.downloaded / progress.total : null;
    if (ratio !== null) { $('#task-progress').max = 1; $('#task-progress').value = Math.min(1, Math.max(0, ratio)); } else $('#task-progress').removeAttribute('value');
    if (progress.log) { currentLog = progress.log; $('#task-log').textContent = currentLog; }
  });
  await refresh().catch(error => message(error.message, true));
}
