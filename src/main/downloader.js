import fs from 'node:fs/promises';
import path from 'node:path';
import { buildDownloadRelativePath } from '../shared/filename.js';
import { isAllowedUrl } from '../shared/security.js';

function decryptBuffer(buffer, decryptorArray) {
  if (!decryptorArray || decryptorArray.length === 0) return buffer;
  const output = Buffer.from(buffer);
  const key = Uint8Array.from(decryptorArray);
  const max = Math.min(output.length, key.length);
  for (let index = 0; index < max; index += 1) {
    output[index] ^= key[index];
  }
  return output;
}

export function createDownloader({ queue, paths, appendRecord, concurrency = 2, fetchImpl = fetch }) {
  let running = false;
  let active = 0;

  async function downloadOne(task) {
    if (!task.url || !isAllowedUrl(task.url)) {
      throw new Error('missing or non-whitelisted media URL');
    }

    queue.markRunning(task.id);
    let buffer;
    if (task.selfTestBody) {
      buffer = Buffer.from(task.selfTestBody, 'utf8');
    } else {
      const response = await fetchImpl(task.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 wx-channel-local-helper'
        }
      });

      if (!response.ok) {
        throw new Error(`download HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    const decrypted = decryptBuffer(buffer, task.decryptorArray);
    const relativePath = buildDownloadRelativePath(task);
    const fullPath = path.join(paths.downloadsDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, decrypted);
    queue.markDone(task.id, fullPath);
    await appendRecord({
      type: 'download_done',
      taskId: task.id,
      videoId: task.videoId,
      title: task.title,
      author: task.author,
      sourceTab: task.sourceTab,
      localPath: fullPath,
      url: task.url
    });
  }

  async function pump() {
    if (!running) return;
    while (active < concurrency) {
      const task = queue.nextQueued();
      if (!task) return;
      active += 1;
      downloadOne(task)
        .catch(async (error) => {
          queue.markFailed(task.id, error.message);
          await appendRecord({
            type: 'download_failed',
            taskId: task.id,
            videoId: task.videoId,
            title: task.title,
            author: task.author,
            sourceTab: task.sourceTab,
            error: error.message,
            url: task.url
          });
        })
        .finally(() => {
          active -= 1;
          setTimeout(pump, 0);
        });
    }
  }

  return {
    start() {
      running = true;
      void pump();
    },
    stop() {
      running = false;
    },
    isRunning() {
      return running;
    },
    nudge() {
      if (running) void pump();
    }
  };
}
