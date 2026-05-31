import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isAllowedHost, isAllowedUrl, redactSensitiveUrl } from '../src/shared/security.js';

describe('security whitelist', () => {
  test('allows WeChat Channels and media CDN hosts', () => {
    assert.equal(isAllowedHost('channels.weixin.qq.com'), true);
    assert.equal(isAllowedHost('res.wx.qq.com'), true);
    assert.equal(isAllowedHost('finder.video.qq.com'), true);
    assert.equal(isAllowedHost('vweixinf.tc.qq.com'), true);
  });

  test('rejects unrelated hosts', () => {
    assert.equal(isAllowedHost('example.com'), false);
    assert.equal(isAllowedHost('evilchannels.weixin.qq.com.example.com'), false);
  });

  test('allows only http and https URLs on allowed hosts', () => {
    assert.equal(isAllowedUrl('https://channels.weixin.qq.com/web/pages/account/like'), true);
    assert.equal(isAllowedUrl('file:///C:/secret.txt'), false);
    assert.equal(isAllowedUrl('https://example.com/video.mp4'), false);
  });

  test('redacts sensitive query values without losing origin and path', () => {
    const url = 'https://finder.video.qq.com/path/video.mp4?token=abc&idx=1&key=secret&exportkey=signed&pass_ticket=ticket&plain=ok';
    assert.equal(
      redactSensitiveUrl(url),
      'https://finder.video.qq.com/path/video.mp4?token=REDACTED&idx=1&key=REDACTED&exportkey=REDACTED&pass_ticket=REDACTED&plain=ok'
    );
  });
});
