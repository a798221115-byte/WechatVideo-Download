import { createApplication } from '../src/main/app-core.js';
import { isAllowedUrl } from '../src/shared/security.js';
import { buildDownloadRelativePath } from '../src/shared/filename.js';

if (!isAllowedUrl('https://channels.weixin.qq.com/web/pages/account/like')) {
  throw new Error('security whitelist build check failed');
}

buildDownloadRelativePath({
  author: 'author',
  title: 'title',
  videoId: 'id',
  capturedAt: new Date().toISOString()
});

if (typeof createApplication !== 'function') {
  throw new Error('application factory is not available');
}

console.log('Build check passed');
