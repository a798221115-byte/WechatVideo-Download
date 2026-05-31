import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { createLocalServer } from '../src/main/local-server.js';
import { createDownloadQueue } from '../src/main/download-queue.js';

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
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videos: [{ videoId: 'empty-url', title: 'No URL' }] })
      });

      assert.equal(response.status, 422);
      assert.equal(queue.list().length, 0);
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
});
