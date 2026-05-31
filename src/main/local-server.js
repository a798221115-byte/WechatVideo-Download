import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecords } from './records.js';
import { createMediaStore } from './media-store.js';
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPublicTask(queue, id, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = queue.list().find((item) => item.id === id);
    if (task && ['done', 'failed', 'cancelled'].includes(task.status)) return task;
    await sleep(50);
  }
  return queue.list().find((item) => item.id === id) || null;
}

function missingMediaMessage(mediaStore) {
  const summary = mediaStore.summary();
  const latestText = summary.latestCapturedAt
    ? `最近一次捕获：${new Date(summary.latestCapturedAt).toLocaleTimeString('zh-CN', { hour12: false })}，${summary.latestHost || '未知域名'}。`
    : '最近一次捕获：暂无。';
  return [
    '没有匹配到这个卡片的视频地址。',
    `当前本机已捕获 ${summary.count || 0} 个视频地址。${latestText}`,
    '原因：为了避免下载错视频，助手只会在“卡片信息”和“真实播放地址”能对应上时加入下载。',
    '请先点击这张卡片打开视频，等它实际播放 2 秒，再回到赞和收藏页面点击“扫描”或“加入下载”。',
    '如果捕获数量一直是 0，通常是微信的视频请求没有经过本助手代理；常见原因是 VPN/TUN 接管网络、视频号页面没有重新打开，或当前视频请求域名还没有被识别。'
  ].join('\n');
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

export function createLocalServer({ settings, paths, queue, downloader, proxyService, appendRecord, openPath, mediaStore = createMediaStore() }) {
  let server = null;
  const candidates = new Map();

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

    if (request.method === 'GET' && url.pathname === '/api/media') {
      sendJson(response, 200, mediaStore.summary());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/self-test/download') {
      const task = queue.enqueue({
        videoId: `self-test-${Date.now()}`,
        title: '下载链路自检',
        author: 'self-test',
        sourceTab: '自检',
        url: 'https://finder.video.qq.com/self-test.mp4',
        capturedAt: new Date().toISOString(),
        selfTestBody: 'wx-channel-helper self-test mp4 bytes\n'
      });
      downloader.start();
      const result = await waitForPublicTask(queue, task.id);
      if (!result) throw new Error('self-test timed out');
      sendJson(response, result.status === 'done' ? 200 : 500, { ok: result.status === 'done', task: result });
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
      const accepted = toArray(body.entries).filter((entry) => mediaStore.remember(entry)).length;
      await appendRecord({ type: 'media_seen', count: accepted, sourceTab: body.sourceTab || '' });
      sendJson(response, 200, { ok: true, count: accepted });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/__wx_helper/downloads/enqueue') {
      const body = await readJsonBody(request);
      const requestedVideos = toArray(body.videos);
      const items = requestedVideos.map((item) => mediaStore.enrich({
        ...candidates.get(item.videoId),
        ...item,
        capturedAt: item.capturedAt || new Date().toISOString()
      }, { allowRecentFallback: Boolean(item.allowRecentFallback) })).filter((item) => item.url && isAllowedUrl(item.url));
      if (!items.length) {
        await appendRecord({ type: 'downloads_enqueue_rejected', reason: 'missing_media_url', sourceTab: body.sourceTab || '' });
        sendJson(response, 422, { ok: false, error: missingMediaMessage(mediaStore) });
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
