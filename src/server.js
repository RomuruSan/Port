import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { inspectIso, IsoError } from './iso.js';
import { compatibility, profile } from './profile.js';
import { engineStatus, prepareNativeGame } from './packager.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_UPLOAD = 9 * 1024 ** 3;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MIME = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function saveJson(path, value) {
  const temporary = `${path}.new`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, path);
}

async function jsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Envie os dados como JSON.');
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (body.length > 8192) throw new HttpError(413, 'Solicitação muito grande.');
  }
  try { return JSON.parse(body); } catch { throw new HttpError(400, 'JSON inválido.'); }
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export async function createApp(options = {}) {
  const dataDir = resolve(options.dataDir || process.env.PORT_DATA_DIR || join(ROOT, '.port-data'));
  const cacheDir = resolve(process.env.PORT_CACHE_DIR || join(ROOT, '..', '.cache', 'port'));
  const engineDir = resolve(options.engineDir || process.env.PORT_ENGINE_DIR || join(cacheDir, 'engine'));
  const maxUpload = options.maxUpload ?? MAX_UPLOAD;
  const uploadsDir = join(dataDir, 'uploads');
  const projectsDir = join(dataDir, 'projects');
  const recordsDir = join(dataDir, 'records');
  await Promise.all([mkdir(uploadsDir, { recursive: true }), mkdir(projectsDir, { recursive: true }), mkdir(recordsDir, { recursive: true })]);
  const uploads = new Map();
  const projects = new Map();
  for (const id of await readdir(uploadsDir)) {
    if (!UUID.test(id)) continue;
    const value = await readFile(join(uploadsDir, id, 'metadata.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (value) uploads.set(id, value);
  }
  for (const name of await readdir(recordsDir)) {
    if (!UUID.test(name.replace(/\.json$/, ''))) continue;
    const value = await readFile(join(recordsDir, name), 'utf8').then(JSON.parse).catch(() => null);
    if (!value) continue;
    if (!['ready', 'failed'].includes(value.stage)) {
      value.stage = 'failed';
      value.error = 'A preparação foi interrompida quando o aplicativo foi encerrado. Você pode iniciar um novo projeto com a ISO já analisada.';
      await rm(`${join(projectsDir, value.id)}.building`, { recursive: true, force: true });
      await saveJson(join(recordsDir, name), value);
    }
    projects.set(value.id, value);
  }
  let uploadActive = false;
  let active;

  async function receiveUpload(request, response, url) {
    if (uploadActive || active) throw new HttpError(409, 'Aguarde a operação atual antes de enviar outra ISO.');
    if (!request.headers['content-type']?.startsWith('application/octet-stream')) throw new HttpError(415, 'Envie a ISO como arquivo binário.');
    const fileName = basename((url.searchParams.get('name') || '').replaceAll('\\', '/'));
    if (!/\.iso$/i.test(fileName) || fileName.length > 220) throw new HttpError(400, 'Selecione um arquivo com a extensão .iso.');
    const declaredSize = request.headers['content-length'] ? Number(request.headers['content-length']) : null;
    if (declaredSize !== null && (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > maxUpload)) throw new HttpError(413, 'A ISO ultrapassa o limite de tamanho ou está vazia.');
    const disk = await statfs(dataDir);
    if (declaredSize && disk.bavail * disk.bsize < declaredSize * 2 + 1024 ** 3) throw new HttpError(507, 'Falta espaço para guardar a ISO e preparar os dados do jogo.');
    if (uploadActive || active) throw new HttpError(409, 'Aguarde a operação atual antes de enviar outra ISO.');
    uploadActive = true;
    const id = randomUUID();
    const dir = join(uploadsDir, id);
    try {
      await mkdir(dir);
      let received = 0;
      const hash = createHash('sha256');
      const meter = new Transform({ transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > maxUpload) return callback(new HttpError(413, 'A ISO ultrapassa o limite de tamanho.'));
        hash.update(chunk);
        callback(null, chunk);
      } });
      await pipeline(request, meter, createWriteStream(join(dir, 'source.iso'), { flags: 'wx' }));
      const disc = await inspectIso(join(dir, 'source.iso'));
      let support = compatibility(disc);
      if (!disc.containsGameData) support = { supported: false, reason: 'O disco não contém DATA.CVM, necessário para importar os dados de Haunting Ground.' };
      const metadata = { id, fileName, uploadedAt: new Date().toISOString(), sha256: hash.digest('hex'), ...disc, compatibility: support };
      await saveJson(join(dir, 'metadata.json'), metadata);
      uploads.set(id, metadata);
      send(response, 201, metadata);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    } finally { uploadActive = false; }
  }

  async function startProject(body, response) {
    if (active || uploadActive) throw new HttpError(409, 'Uma operação já está em andamento.');
    if (!UUID.test(body?.uploadId || '')) throw new HttpError(400, 'Selecione uma ISO já analisada.');
    const source = uploads.get(body.uploadId);
    if (!source) throw new HttpError(404, 'A ISO selecionada não existe.');
    if (!source.compatibility.supported) throw new HttpError(422, source.compatibility.reason);
    const engine = await engineStatus(engineDir);
    if (!engine.available) throw new HttpError(503, 'O motor OpenHuey ainda não foi configurado. Consulte as instruções de instalação do projeto.');
    if (active || uploadActive) throw new HttpError(409, 'Uma operação já está em andamento.');
    const name = (typeof body.name === 'string' ? body.name.trim() : '') || 'Haunting Ground';
    if (name.length > 80 || /[\x00-\x1f]/.test(name)) throw new HttpError(400, 'Use um nome de projeto com até 80 caracteres.');
    const id = randomUUID();
    const record = { id, name, uploadId: source.id, createdAt: new Date().toISOString(), stage: 'queued', target: `${process.platform}-${process.arch}`, log: '', gameplayVerified: false };
    const controller = new AbortController();
    active = { id, controller, promise: null };
    projects.set(id, record);
    const persist = () => saveJson(join(recordsDir, `${id}.json`), record);
    try { await persist(); } catch (error) { active = undefined; projects.delete(id); throw error; }
    const work = active;
    work.promise = (async () => {
      try {
        const output = await prepareNativeGame({
          engine, isoPath: join(uploadsDir, source.id, 'source.iso'), outputDir: join(projectsDir, id), source,
          signal: controller.signal,
          onStage: async stage => { record.stage = stage; await persist(); },
          onLog: message => { record.log = (record.log + message).slice(-32000); },
        });
        Object.assign(record, output, { stage: 'ready', completedAt: new Date().toISOString() });
      } catch (error) {
        record.stage = 'failed';
        record.error = error.message;
      } finally {
        try { await persist(); } catch (error) { console.error('Não foi possível salvar o resultado do projeto:', error.message); }
        if (active === work) active = undefined;
      }
    })();
    send(response, 202, record);
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const host = request.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new HttpError(403, 'Use o endereço local do aplicativo.');
      if (request.headers.origin && ![`http://${host}`, `https://${host}`].includes(request.headers.origin)) throw new HttpError(403, 'Origem da solicitação não permitida.');
      const url = new URL(request.url, `http://${host}`);
      if (request.method === 'GET' && url.pathname === '/api/status') {
        return send(response, 200, { profile, engine: await engineStatus(engineDir), maxUploadBytes: maxUpload, busy: Boolean(active || uploadActive), uploads: [...uploads.values()].reverse(), projects: [...projects.values()].reverse() });
      }
      if (request.method === 'POST' && url.pathname === '/api/uploads') return await receiveUpload(request, response, url);
      if (request.method === 'POST' && url.pathname === '/api/projects') return await startProject(await jsonBody(request), response);
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/uploads/')) {
        const id = url.pathname.slice('/api/uploads/'.length);
        if (!UUID.test(id) || !uploads.has(id)) throw new HttpError(404, 'ISO não encontrada.');
        if (active || uploadActive) throw new HttpError(409, 'Aguarde a operação atual antes de remover uma ISO.');
        await rm(join(uploadsDir, id), { recursive: true, force: true });
        uploads.delete(id);
        return send(response, 200, { deleted: true });
      }
      if (request.method === 'GET' && MIME[url.pathname]) {
        const [file, type] = MIME[url.pathname];
        response.writeHead(200, { 'Content-Type': type });
        await pipeline(createReadStream(join(ROOT, 'public', file)), response);
        return;
      }
      throw new HttpError(404, 'Página ou operação não encontrada.');
    } catch (error) {
      if (!response.destroyed && !response.headersSent) {
        const status = error.status || (error instanceof IsoError ? 422 : 500);
        if (status === 500) console.error(error.message);
        send(response, status, { error: status === 500 ? 'Não foi possível concluir a operação. Consulte o terminal do aplicativo.' : error.message });
      }
    }
  });
  // ISO uploads and asset conversion can take minutes. No arbitrary two-minute request cutoff.
  server.requestTimeout = 0;
  server.headersTimeout = 30000;
  server.stopWork = async () => {
    if (active) { active.controller.abort(); await active.promise; }
  };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT precisa estar entre 1 e 65535.');
  const app = await createApp();
  app.listen(port, '127.0.0.1', () => console.log(`Port iniciado na porta ${port}. Perfil: Haunting Ground (EUA).`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await app.stopWork();
    app.close();
    app.closeAllConnections();
  });
}
