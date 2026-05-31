import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecords } from './records.js';
import { isAllowedUrl } from '../shared/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', '..', 'public');
const injectedDir = path.resolve(__dirname, '..', 'injected');

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8']
]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeUrlKey(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return String(value || '').split('?')[0].toLowerCase();
  }
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function textMatches(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400'
  };
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...corsHeaders(),
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

function sendOptions(response) {
  response.writeHead(204, {
    ...corsHeaders(),
    'content-length': '0',
    'x-content-type-options': 'nosniff'
  });
  response.end();
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function sendFile(response, filePath) {
  const body = await fs.readFile(filePath);
  const type = MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

async function tryStatic(requestPath, response) {
  const cleanPath = requestPath === '/' ? '/index.html' : requestPath;
  const resolved = path.resolve(publicDir, `.${cleanPath}`);
  if (!resolved.startsWith(publicDir)) return false;
  try {
    await sendFile(response, resolved);
    return true;
  } catch {
    return false;
  }
}

export function createLocalServer({ settings, paths, queue, downloader, proxyService, appendRecord, openPath }) {
  let server = null;
  const candidates = new Map();
  let mediaEntries = [];

  function rememberMediaEntry(entry) {
    if (!entry?.url || !isAllowedUrl(entry.url)) return false;
    const key = normalizeUrlKey(entry.url);
    if (mediaEntries.some((item) => normalizeUrlKey(item.url) === key)) return false;
    mediaEntries.unshift({
      videoId: entry.videoId || '',
      title: entry.title || '',
      coverUrl: entry.coverUrl || '',
      objectId: entry.objectId || '',
      url: entry.url,
      capturedAt: Date.now()
    });
    const cutoff = Date.now() - 15 * 60 * 1000;
    mediaEntries = mediaEntries.filter((item) => Number(item.capturedAt || 0) >= cutoff).slice(0, 500);
    return true;
  }

  function enrichWithSharedMedia(item) {
    if (item.url && isAllowedUrl(item.url)) return item;
    const coverKey = normalizeUrlKey(item.coverUrl);
    const matched = mediaEntries.find((entry) => {
      if (item.videoId && entry.videoId && item.videoId === entry.videoId) return true;
      if (item.objectId && entry.objectId && item.objectId === entry.objectId) return true;
      if (coverKey && normalizeUrlKey(entry.coverUrl) === coverKey) return true;
      if (textMatches(item.title, entry.title)) return true;
      return false;
    });
    return matched?.url ? { ...item, url: matched.url } : item;
  }

  async function route(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);

    if (request.method === 'OPTIONS') {
      sendOptions(response);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/wx-helper-page.js') {
      await sendFile(response, path.join(injectedDir, 'page-helper.js'));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/settings') {
      sendJson(response, 200, { ...settings, downloadsDir: paths.downloadsDir });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/proxy') {
      sendJson(response, 200, proxyService?.status ? proxyService.status() : { running: false, port: settings.proxyPort });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/proxy/start') {
      if (!proxyService) throw new Error('proxy service is unavailable');
      sendJson(response, 200, await proxyService.start());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/proxy/stop') {
      if (!proxyService) throw new Error('proxy service is unavailable');
      await proxyService.stop();
      sendJson(response, 200, { running: false, port: settings.proxyPort });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/downloads') {
      sendJson(response, 200, { tasks: queue.list() });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/records') {
      sendJson(response, 200, { records: await readRecords(paths.recordsFile) });
      return;
    }

    const retryMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/retry$/);
    if (request.method === 'POST' && retryMatch) {
      const task = queue.retry(retryMatch[1]);
      downloader.nudge();
      sendJson(response, 200, { task });
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && cancelMatch) {
      sendJson(response, 200, { task: queue.cancel(cancelMatch[1]) });
      return;
    }

    const openFolderMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/open-folder$/);
    if (request.method === 'POST' && openFolderMatch) {
      if (!openPath) throw new Error('open folder is unavailable');
      const task = queue.get(openFolderMatch[1]);
      if (!task.localPath) throw new Error('download file path is empty');
      const resolvedFile = path.resolve(task.localPath);
      const resolvedDownloads = path.resolve(paths.downloadsDir);
      if (resolvedFile !== resolvedDownloads && !resolvedFile.startsWith(`${resolvedDownloads}${path.sep}`)) {
        throw new Error('download file path is outside downloads directory');
      }
      await openPath(path.dirname(resolvedFile));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/__wx_helper/candidates') {
      const body = await readJsonBody(request);
      const items = toArray(body.candidates);
      for (const item of items) {
        if (item?.videoId) candidates.set(item.videoId, item);
      }
      await appendRecord({ type: 'candidates_seen', count: items.length, sourceTab: body.sourceTab || '' });
      sendJson(response, 200, { ok: true, count: items.length });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/__wx_helper/media') {
      const body = await readJsonBody(request);
      const accepted = toArray(body.entries).filter(rememberMediaEntry).length;
      await appendRecord({ type: 'media_seen', count: accepted, sourceTab: body.sourceTab || '' });
      sendJson(response, 200, { ok: true, count: accepted });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/__wx_helper/downloads/enqueue') {
      const body = await readJsonBody(request);
      const items = toArray(body.videos).map((item) => enrichWithSharedMedia({
        ...candidates.get(item.videoId),
        ...item,
        capturedAt: item.capturedAt || new Date().toISOString()
      })).filter((item) => item.url && isAllowedUrl(item.url));
      if (!items.length) {
        await appendRecord({ type: 'downloads_enqueue_rejected', reason: 'missing_media_url', sourceTab: body.sourceTab || '' });
        sendJson(response, 422, { ok: false, error: '未找到可下载的视频地址，请先点开播放一次或点击页面工具条的“扫描”。' });
        return;
      }
      const tasks = queue.enqueueMany(items);
      await appendRecord({ type: 'downloads_enqueued', count: tasks.length, sourceTab: body.sourceTab || '' });
      downloader.start();
      sendJson(response, 200, { ok: true, addedCount: items.length, tasks: queue.list() });
      return;
    }

    if (request.method === 'GET' && await tryStatic(url.pathname, response)) return;
    sendJson(response, 404, { ok: false, error: 'not found' });
  }

  return {
    async start(port = settings.appPort) {
      if (server) return server.address().port;
      server = http.createServer((request, response) => {
        route(request, response).catch((error) => {
          sendJson(response, 500, { ok: false, error: error.message });
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      return server.address().port;
    },
    async stop() {
      if (!server) return;
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      server = null;
    },
    url() {
      if (!server) return `http://127.0.0.1:${settings.appPort}`;
      return `http://127.0.0.1:${server.address().port}`;
    }
  };
}
