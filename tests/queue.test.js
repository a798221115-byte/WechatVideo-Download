import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDownloadQueue } from '../src/main/download-queue.js';

describe('download queue', () => {
  test('deduplicates by videoId and keeps existing task status', () => {
    const queue = createDownloadQueue();
    const first = queue.enqueue({
      videoId: 'v1',
      title: 'A',
      author: 'Author',
      sourceTab: '收藏',
      url: 'https://finder.video.qq.com/a.mp4'
    });
    queue.markRunning(first.id);

    const second = queue.enqueue({
      videoId: 'v1',
      title: 'A copy',
      author: 'Author',
      sourceTab: '点赞',
      url: 'https://finder.video.qq.com/a.mp4'
    });

    assert.equal(second.id, first.id);
    assert.equal(queue.list().length, 1);
    assert.equal(queue.list()[0].status, 'running');
  });

  test('supports retrying failed tasks', () => {
    const queue = createDownloadQueue();
    const task = queue.enqueue({
      videoId: 'v2',
      title: 'B',
      author: 'Author',
      sourceTab: '全部',
      url: 'https://finder.video.qq.com/b.mp4'
    });
    queue.markFailed(task.id, 'network');

    const retried = queue.retry(task.id);

    assert.equal(retried.status, 'queued');
    assert.equal(retried.error, '');
    assert.equal(retried.attempts, 1);
  });
});
