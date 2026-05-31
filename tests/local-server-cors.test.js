import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { createLocalServer } from '../src/main/local-server.js';
import { createDownloadQueue } from '../src/main/download-queue.js';
import { createDownloader } from '../src/main/downloader.js';
import { createMediaStore } from '../src/main/media-store.js';

async function waitForTask(queue, predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const task = queue.list()[0];
    if (task && predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for task state');
}

describe('local server CORS', () => {
  test('answers browser preflight requests for injected page APIs', async () => {
    const queue = createDownloadQueue();
    const server = createLocalServer({
      settings: { appPort: 0, proxyPort: 20251 },
      paths: {
        downloadsDir: path.join(os.tmpdir(), 'wx-helper-test-downloads'),
        recordsFile: path.join(os.tmpdir(), 'wx-helper-test-records.jsonl')
      },
      queue,
      downloader: { start() {}, nudge() {} },
      proxyService: { status: () => ({ running: false, port: 20251 }) },
      appendRecord: async () => {}
    });

    const port = await server.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__wx_helper/downloads/enqueue`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://channels.weixin.qq.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type'
        }
      });

      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      assert.match(response.headers.get('access-control-allow-methods'), /POST/);
      assert.match(response.headers.get('access-control-allow-headers'), /content-type/);
    } finally {
      await server.stop();
    }
  });

  test('rejects enqueue requests without a downloadable media URL', async () => {
    const queue = createDownloadQueue();
    const mediaStore = createMediaStore();
    mediaStore.remember({
      videoId: 'other-video',
      title: 'Other captured video',
      url: 'https://finder.video.qq.com/other-video.mp4'
    });
    const server = createLocalServer({
      settings: { appPort: 0, proxyPort: 20251 },
      paths: {
        downloadsDir: path.join(os.tmpdir(), 'wx-helper-test-downloads'),
        recordsFile: path.join(os.tmpdir(), 'wx-helper-test-records.jsonl')
      },
      queue,
      downloader: { start() {}, nudge() {} },
      proxyService: { status: () => ({ running: false, port: 20251 }) },
      appendRecord: async () => {},
      mediaStore
    });

    const port = await server.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__wx_helper/downloads/enqueue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          videos: [
            { videoId: 'empty-url-1', title: 'No URL 1' },
            { videoId: 'empty-url-2', title: 'No URL 2' }
          ]
        })
      });
      const payload = await response.json();

      assert.equal(response.status, 422);
      assert.equal(payload.ok, false);
      assert.match(payload.error, /没有匹配到这个卡片的视频地址/);
      assert.match(payload.error, /当前本机已捕获 1 个视频地址/);
      assert.equal(queue.list().length, 0);
    } finally {
      await server.stop();
    }
  });

  test('enriches enqueue requests from shared media captured by another page', async () => {
    const queue = createDownloadQueue();
    const server = createLocalServer({
      settings: { appPort: 0, proxyPort: 20251 },
      paths: {
        downloadsDir: path.join(os.tmpdir(), 'wx-helper-test-downloads'),
        recordsFile: path.join(os.tmpdir(), 'wx-helper-test-records.jsonl')
      },
      queue,
      downloader: { start() {}, nudge() {} },
      proxyService: { status: () => ({ running: false, port: 20251 }) },
      appendRecord: async () => {}
    });

    const port = await server.start(0);
    try {
      const mediaResponse = await fetch(`http://127.0.0.1:${port}/__wx_helper/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entries: [{
            videoId: 'shared-video',
            title: 'Shared title',
            url: 'https://finder.video.qq.com/shared-video.mp4?token=abc'
          }]
        })
      });
      assert.equal(mediaResponse.status, 200);

      const enqueueResponse = await fetch(`http://127.0.0.1:${port}/__wx_helper/downloads/enqueue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videos: [{ videoId: 'shared-video', title: 'Shared title' }] })
      });

      assert.equal(enqueueResponse.status, 200);
      assert.equal(queue.list().length, 1);
      assert.equal(queue.list()[0].url, 'https://finder.video.qq.com/shared-video.mp4?token=abc');
    } finally {
      await server.stop();
    }
  });

  test('matches shared media by title when ids differ across page contexts', async () => {
    const queue = createDownloadQueue();
    const server = createLocalServer({
      settings: { appPort: 0, proxyPort: 20251 },
      paths: {
        downloadsDir: path.join(os.tmpdir(), 'wx-helper-test-downloads'),
        recordsFile: path.join(os.tmpdir(), 'wx-helper-test-records.jsonl')
      },
      queue,
      downloader: { start() {}, nudge() {} },
      proxyService: { status: () => ({ running: false, port: 20251 }) },
      appendRecord: async () => {}
    });

    const port = await server.start(0);
    try {
      await fetch(`http://127.0.0.1:${port}/__wx_helper/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entries: [{
            videoId: 'detail-id',
            title: '同一个视频标题',
            url: 'https://finder.video.qq.com/title-match.mp4'
          }]
        })
      });

      const response = await fetch(`http://127.0.0.1:${port}/__wx_helper/downloads/enqueue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videos: [{ videoId: 'list-id', title: '同一个视频标题' }] })
      });

      assert.equal(response.status, 200);
      assert.equal(queue.list()[0].url, 'https://finder.video.qq.com/title-match.mp4');
    } finally {
      await server.stop();
    }
  });

  test('downloads an enqueued video to local disk after shared media enrichment', async () => {
    const queue = createDownloadQueue();
    const mediaStore = createMediaStore();
    mediaStore.remember({
      videoId: 'downloaded-video',
      title: 'Downloaded title',
      url: 'https://finder.video.qq.com/downloaded-video.mp4'
    });
    const downloadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wx-helper-e2e-downloads-'));
    const downloader = createDownloader({
      queue,
      paths: { downloadsDir },
      appendRecord: async () => {},
      concurrency: 1,
      fetchImpl: async () => new globalThis.Response(Buffer.from('fake mp4 bytes'), { status: 200 })
    });
    const server = createLocalServer({
      settings: { appPort: 0, proxyPort: 20251 },
      paths: {
        downloadsDir,
        recordsFile: path.join(os.tmpdir(), 'wx-helper-test-records.jsonl')
      },
      queue,
      downloader,
      proxyService: { status: () => ({ running: false, port: 20251 }) },
      appendRecord: async () => {},
      mediaStore
    });

    const port = await server.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__wx_helper/downloads/enqueue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceTab: '赞和收藏',
          videos: [{ videoId: 'downloaded-video', title: 'Downloaded title', author: 'Tester' }]
        })
      });

      assert.equal(response.status, 200);
      const doneTask = await waitForTask(queue, (task) => task.status === 'done' || task.status === 'failed');
      assert.equal(doneTask.status, 'done');
      assert.match(doneTask.localPath, /downloaded-video/);
      assert.equal(await fs.readFile(doneTask.localPath, 'utf8'), 'fake mp4 bytes');
    } finally {
      await server.stop();
    }
  });

  test('rejects recent captured media fallback unless the selected card opts in', async () => {
    const queue = createDownloadQueue();
    const mediaStore = createMediaStore();
    mediaStore.remember({
      title: 'Recently played detail page title',
      url: 'https://finder.video.qq.com/recently-played.mp4?token=abc'
    });
    const server = createLocalServer({
      settings: { appPort: 0, proxyPort: 20251 },
      paths: {
        downloadsDir: path.join(os.tmpdir(), 'wx-helper-test-downloads'),
        recordsFile: path.join(os.tmpdir(), 'wx-helper-test-records.jsonl')
      },
      queue,
      downloader: { start() {}, nudge() {} },
      proxyService: { status: () => ({ running: false, port: 20251 }) },
      appendRecord: async () => {},
      mediaStore
    });

    const port = await server.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__wx_helper/downloads/enqueue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceTab: '赞和收藏',
          videos: [{ videoId: 'unmatched-list-card', title: 'Completely different title', author: 'Recent Fallback Tester' }]
        })
      });

      assert.equal(response.status, 422);
      assert.equal(queue.list().length, 0);
    } finally {
      await server.stop();
    }
  });

  test('falls back to the most recent captured media only when the selected card opts in', async () => {
    const queue = createDownloadQueue();
    const mediaStore = createMediaStore();
    mediaStore.remember({
      title: 'Recently played detail page title',
      url: 'https://finder.video.qq.com/recently-played.mp4?token=abc'
    });
    const downloadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wx-helper-recent-downloads-'));
    const downloader = createDownloader({
      queue,
      paths: { downloadsDir },
      appendRecord: async () => {},
      concurrency: 1,
      fetchImpl: async () => new globalThis.Response(Buffer.from('recent fallback bytes'), { status: 200 })
    });
    const server = createLocalServer({
      settings: { appPort: 0, proxyPort: 20251 },
      paths: {
        downloadsDir,
        recordsFile: path.join(os.tmpdir(), 'wx-helper-test-records.jsonl')
      },
      queue,
      downloader,
      proxyService: { status: () => ({ running: false, port: 20251 }) },
      appendRecord: async () => {},
      mediaStore
    });

    const port = await server.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__wx_helper/downloads/enqueue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceTab: '赞和收藏',
          videos: [{
            videoId: 'unmatched-list-card',
            title: 'Completely different title',
            author: 'Recent Fallback Tester',
            allowRecentFallback: true
          }]
        })
      });

      assert.equal(response.status, 200);
      const doneTask = await waitForTask(queue, (task) => task.status === 'done' || task.status === 'failed');
      assert.equal(doneTask.status, 'done');
      assert.equal(doneTask.url, 'https://finder.video.qq.com/recently-played.mp4?token=abc');
      assert.equal(await fs.readFile(doneTask.localPath, 'utf8'), 'recent fallback bytes');
    } finally {
      await server.stop();
    }
  });

  test('opens the folder for completed downloads', async () => {
    const queue = createDownloadQueue();
    const downloadsDir = path.join(os.tmpdir(), 'wx-helper-test-downloads');
    const task = queue.enqueue({
      videoId: 'done-video',
      title: 'Done',
      author: 'Author',
      url: 'https://finder.video.qq.com/video.mp4'
    });
    const localPath = path.join(downloadsDir, 'Author', 'done-video.mp4');
    queue.markDone(task.id, localPath);

    let openedPath = '';
    const server = createLocalServer({
      settings: { appPort: 0, proxyPort: 20251 },
      paths: {
        downloadsDir,
        recordsFile: path.join(os.tmpdir(), 'wx-helper-test-records.jsonl')
      },
      queue,
      downloader: { start() {}, nudge() {} },
      proxyService: { status: () => ({ running: false, port: 20251 }) },
      appendRecord: async () => {},
      openPath: async (targetPath) => {
        openedPath = targetPath;
      }
    });

    const port = await server.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/downloads/${task.id}/open-folder`, {
        method: 'POST'
      });

      assert.equal(response.status, 200);
      assert.equal(openedPath, path.dirname(localPath));
    } finally {
      await server.stop();
    }
  });

  test('runs a local download self-test through the queue and downloader', async () => {
    const queue = createDownloadQueue();
    const downloadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wx-helper-self-test-downloads-'));
    const records = [];
    const downloader = createDownloader({
      queue,
      paths: { downloadsDir },
      appendRecord: async (record) => records.push(record),
      concurrency: 1,
      fetchImpl: async () => {
        throw new Error('self-test should not use the network');
      }
    });
    const server = createLocalServer({
      settings: { appPort: 0, proxyPort: 20251 },
      paths: {
        downloadsDir,
        recordsFile: path.join(os.tmpdir(), 'wx-helper-test-records.jsonl')
      },
      queue,
      downloader,
      proxyService: { status: () => ({ running: false, port: 20251 }) },
      appendRecord: async (record) => records.push(record)
    });

    const port = await server.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/self-test/download`, {
        method: 'POST'
      });
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.task.status, 'done');
      assert.equal(payload.task.selfTestBody, undefined);
      assert.equal(await fs.readFile(payload.task.localPath, 'utf8'), 'wx-channel-helper self-test mp4 bytes\n');
      assert.equal(records.some((record) => record.type === 'download_done'), true);
    } finally {
      await server.stop();
    }
  });
});
