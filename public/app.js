const $ = selector => document.querySelector(selector);
let state;
let selectedId;
let uploading = false;
let starting = false;
let statusPending = false;

const stages = { queued: 'Na fila', copying: 'Preparando motor', importing: 'Importando dados', ready: 'Pasta preparada', failed: 'Preparação interrompida' };
const formatSize = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').classList.toggle('error', error);
  $('#notice').hidden = !message;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'A operação não foi concluída.');
  return value;
}

function textElement(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function render() {
  if (!state) return;
  const selected = state.uploads.find(item => item.id === selectedId);
  $('#engine-badge').classList.toggle('available', state.engine.available);
  $('#engine-badge').title = state.engine.available ? `OpenHuey ${state.engine.version} disponível` : 'Motor nativo ainda não configurado';
  $('#engine-notice').hidden = state.engine.available;
  const platform = state.engine.host === 'win32' ? 'Windows' : state.engine.host === 'linux' ? 'Linux' : state.engine.host;
  $('#target').textContent = `${platform} · motor nativo deste computador`;
  $('#build').disabled = uploading || starting || state.busy || !selected?.compatibility.supported || !state.engine.available;
  $('#build span').textContent = starting || state.busy && !uploading ? 'Preparação em andamento…' : 'Preparar jogo para PC';
  $('#dropzone').classList.toggle('disabled', uploading || state.busy);
  $('#iso-file').disabled = uploading || state.busy;
  $('#disc-info').hidden = !selected;
  $('#remove-upload').disabled = state.busy;
  $('#stored-isos').hidden = state.uploads.length < 2;
  const stored = $('#stored-iso');
  if (stored.options.length !== state.uploads.length || [...stored.options].some((item, index) => item.value !== state.uploads[index]?.id)) {
    stored.replaceChildren(...state.uploads.map(upload => {
      const option = textElement('option', upload.fileName);
      option.value = upload.id;
      return option;
    }));
  }
  stored.value = selectedId || '';
  if (selected) {
    $('#disc-file').textContent = selected.fileName;
    $('#compatibility-badge').textContent = selected.compatibility.supported ? 'RECONHECIDA' : 'NÃO COMPATÍVEL';
    $('#compatibility-badge').classList.toggle('unsupported', !selected.compatibility.supported);
    $('#compatibility-reason').textContent = selected.compatibility.reason;
    const details = $('#disc-details');
    details.replaceChildren();
    for (const [name, value] of [['Região', selected.region], ['Executável', selected.serial], ['Tamanho', formatSize(selected.sizeBytes)], ['CRC32 ELF', selected.executable.crc32], ['SHA-256 ISO', selected.sha256]]) {
      details.append(textElement('dt', name), textElement('dd', value));
    }
  }
  $('#project-count').textContent = `${state.projects.length} ${state.projects.length === 1 ? 'PROJETO' : 'PROJETOS'}`;
  if (state.projects.length) {
    const nodes = state.projects.map(project => {
      const card = textElement('article', '', 'project');
      const head = textElement('div', '', 'project-head');
      const identity = textElement('div', '');
      identity.append(textElement('strong', project.name), textElement('small', `${project.target} · ${new Date(project.createdAt).toLocaleString('pt-BR')}`));
      head.append(identity, textElement('span', stages[project.stage] || project.stage, 'project-stage'));
      card.append(head);
      if (project.stage === 'ready') {
        card.append(textElement('p', 'Pasta preparada. Abra o executável abaixo no computador de destino para validar o jogo.'));
        card.append(document.createElement('p'));
        card.lastChild.append(textElement('code', project.executable));
        card.append(textElement('p', 'O jogo ainda não foi testado automaticamente. A ISO armazenada pode ser removida após você confirmar a importação.'));
      } else if (project.error) card.append(textElement('p', project.error));
      else card.append(textElement('p', 'O OpenHuey está preparando os dados. Acompanhe o registro; o tempo depende do disco e do computador.'));
      if (project.log) {
        const details = document.createElement('details');
        details.append(textElement('summary', 'Ver registro do motor'), textElement('pre', project.log));
        card.append(details);
      }
      return card;
    });
    $('#projects').replaceChildren(...nodes);
  }
}

async function refresh() {
  if (statusPending) return;
  statusPending = true;
  try {
    state = await api('/api/status');
    if (!selectedId || !state.uploads.some(upload => upload.id === selectedId)) selectedId = state.uploads[0]?.id;
    $('#connection').classList.add('online');
    $('#connection').lastChild.textContent = ' Ambiente local';
    render();
  } catch {
    $('#connection').classList.remove('online');
    $('#connection').lastChild.textContent = ' Sem conexão';
    $('#build').disabled = true;
  } finally { statusPending = false; }
}

function sendFile(file) {
  if (!file || uploading || state?.busy) return;
  if (!/\.iso$/i.test(file.name)) return notice('Selecione uma ISO de PS2. PKG, CHD e arquivos compactados não são aceitos.', true);
  if (file.size > (state?.maxUploadBytes || 9 * 1024 ** 3)) return notice('A ISO ultrapassa o limite de 9 GiB.', true);
  uploading = true;
  notice('');
  $('#upload-progress').hidden = false;
  $('#progress-fill').style.width = '0%';
  $('#progress-text').textContent = 'Enviando ISO para análise…';
  render();
  const request = new XMLHttpRequest();
  request.open('POST', `/api/uploads?name=${encodeURIComponent(file.name)}`);
  request.setRequestHeader('Content-Type', 'application/octet-stream');
  request.upload.onprogress = event => {
    if (!event.lengthComputable) return;
    const percent = Math.round(event.loaded / event.total * 100);
    $('#progress-fill').style.width = `${percent}%`;
    $('#progress-text').textContent = percent === 100 ? 'Lendo o disco e verificando o executável…' : `Enviando ISO · ${percent}%`;
  };
  const finish = () => {
    uploading = false;
    $('#upload-progress').hidden = true;
    $('#iso-file').value = '';
    refresh();
  };
  request.onload = () => {
    try {
      const result = JSON.parse(request.responseText);
      if (request.status !== 201) throw new Error(result.error || 'Não foi possível analisar a ISO.');
      selectedId = result.id;
      notice(result.compatibility.supported ? 'ISO reconhecida. Você já pode preparar a pasta do jogo.' : result.compatibility.reason, !result.compatibility.supported);
    } catch (error) { notice(error.message, true); }
    finish();
  };
  request.onerror = () => { notice('O envio foi interrompido. Verifique a conexão e o espaço disponível e tente novamente.', true); finish(); };
  request.send(file);
}

$('#iso-file').addEventListener('change', event => sendFile(event.target.files[0]));
$('#stored-iso').addEventListener('change', event => { selectedId = event.target.value; notice(''); render(); });
for (const eventName of ['dragenter', 'dragover']) $('#dropzone').addEventListener(eventName, event => { event.preventDefault(); $('#dropzone').classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) $('#dropzone').addEventListener(eventName, event => { event.preventDefault(); $('#dropzone').classList.remove('dragging'); });
$('#dropzone').addEventListener('drop', event => sendFile(event.dataTransfer.files[0]));
$('#build').addEventListener('click', async () => {
  if (starting || !selectedId) return;
  starting = true;
  notice('');
  render();
  try {
    await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: selectedId, name: $('#project-name').value }) });
    $('#projects-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { notice(error.message, true); }
  finally { starting = false; await refresh(); }
});
$('#remove-upload').addEventListener('click', async () => {
  if (!selectedId) return;
  try {
    await api(`/api/uploads/${selectedId}`, { method: 'DELETE' });
    selectedId = undefined;
    notice('ISO removida do armazenamento do Port. O arquivo no seu computador e as pastas já preparadas foram preservados.');
    await refresh();
  } catch (error) { notice(error.message, true); }
});
await refresh();
setInterval(refresh, 2000);
