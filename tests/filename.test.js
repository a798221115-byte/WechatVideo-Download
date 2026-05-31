import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildDownloadRelativePath, sanitizeSegment } from '../src/shared/filename.js';

describe('filename helpers', () => {
  test('sanitizes Windows-unsafe filename characters', () => {
    assert.equal(sanitizeSegment('陈:野*y / demo?'), '陈_野_y _ demo_');
  });

  test('builds author/date/title/id mp4 path', () => {
    const task = {
      author: '清风/知识篇',
      title: '警方扫黄为什么不用收款记录寻嫖客',
      videoId: 'finder-123',
      capturedAt: '2026-05-30T10:12:00.000Z'
    };

    assert.equal(buildDownloadRelativePath(task), '清风_知识篇/2026-05-30_警方扫黄为什么不用收款记录寻嫖客_finder-123.mp4');
  });
});
