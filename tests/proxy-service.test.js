import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getRequestHost, getRequestUrl, isChannelsHostRequest, isChannelsPageRequest, isLikelyMediaRequestUrl, proxyConfigFromSnapshot, scanTextForMediaUrls, tlsInterceptTargets } from '../src/main/proxy-service.js';

describe('proxy request detection', () => {
  test('detects absolute channels page URLs', () => {
    const req = {
      protocol: 'https',
      url: 'https://channels.weixin.qq.com/web/pages/account/like',
      path: '/web/pages/account/like',
      headers: {},
      destination: { hostname: 'channels.weixin.qq.com' }
    };

    assert.equal(getRequestHost(req), 'channels.weixin.qq.com');
    assert.equal(isChannelsHostRequest(req), true);
    assert.equal(getRequestUrl(req).pathname, '/web/pages/account/like');
    assert.equal(isChannelsPageRequest(req), true);
  });

  test('detects intercepted HTTPS requests that expose only a relative path', () => {
    const req = {
      protocol: 'https',
      url: '/web/pages/account/like',
      path: '/web/pages/account/like',
      headers: { host: 'channels.weixin.qq.com' },
      destination: { hostname: 'channels.weixin.qq.com' }
    };

    assert.equal(getRequestHost(req), 'channels.weixin.qq.com');
    assert.equal(getRequestUrl(req).toString(), 'https://channels.weixin.qq.com/web/pages/account/like');
    assert.equal(isChannelsPageRequest(req), true);
  });

  test('rejects non-page channels requests for UI injection', () => {
    const req = {
      protocol: 'https',
      url: '/favicon.ico',
      path: '/favicon.ico',
      headers: { host: 'channels.weixin.qq.com' },
      destination: { hostname: 'channels.weixin.qq.com' }
    };

    assert.equal(isChannelsHostRequest(req), true);
    assert.equal(isChannelsPageRequest(req), false);
  });

  test('uses the previous Windows proxy as an upstream proxy', () => {
    assert.deepEqual(
      proxyConfigFromSnapshot({ proxyEnable: '0x1', proxyServer: '127.0.0.1:10808' }, 20251),
      { proxyUrl: 'http://127.0.0.1:10808', noProxy: ['127.0.0.1', 'localhost'] }
    );
    assert.deepEqual(
      proxyConfigFromSnapshot({ proxyEnable: '1', proxyServer: 'http=127.0.0.1:10808;https=127.0.0.1:10808' }, 20251),
      { proxyUrl: 'http://127.0.0.1:10808', noProxy: ['127.0.0.1', 'localhost'] }
    );
    assert.equal(proxyConfigFromSnapshot({ proxyEnable: '1', proxyServer: '127.0.0.1:20251' }, 20251), undefined);
  });

  test('intercepts Channels pages and video media hosts for URL capture', () => {
    assert.deepEqual(
      tlsInterceptTargets(),
      [
        { hostname: 'channels.weixin.qq.com' },
        { hostname: 'finder.video.qq.com' },
        { hostname: 'finder.video.weixin.qq.com' },
        { hostname: '*.video.qq.com' },
        { hostname: '*.weixin.qq.com' },
        { hostname: '*.wx.qq.com' }
      ]
    );
  });

  test('detects likely media request URLs without matching normal pages', () => {
    assert.equal(isLikelyMediaRequestUrl('https://finder.video.qq.com/video.mp4?token=abc'), true);
    assert.equal(isLikelyMediaRequestUrl('https://v6-finder.video.qq.com/video/foo?token=abc'), true);
    assert.equal(isLikelyMediaRequestUrl('https://finder.video.weixin.qq.com/video/foo?token=abc'), true);
    assert.equal(isLikelyMediaRequestUrl('https://weixin110.qq.com/security/readtemplate?t=weixin_report/w_type&scene=33'), false);
    assert.equal(isLikelyMediaRequestUrl('https://vweixinf.tc.qq.com/video/foo?token=abc'), false);
    assert.equal(isLikelyMediaRequestUrl('https://channels.weixin.qq.com/web/pages/feed'), false);
    assert.equal(isLikelyMediaRequestUrl('https://example.com/video.mp4'), false);
  });

  test('extracts escaped media URLs from Channels response text', () => {
    assert.deepEqual(
      scanTextForMediaUrls('{"url":"https:\\/\\/finder.video.qq.com\\/video.mp4?token=abc","page":"https:\\/\\/channels.weixin.qq.com\\/web\\/pages\\/feed"}'),
      ['https://finder.video.qq.com/video.mp4?token=abc']
    );
  });
});
