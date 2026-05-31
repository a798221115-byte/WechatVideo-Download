import fs from 'node:fs/promises';

export const DEFAULT_SETTINGS = {
  appPort: 20250,
  proxyPort: 20251,
  downloadConcurrency: 2,
  captureLimitDefault: 200,
  autoInstallCertificate: true,
  allowedTabs: ['全部', '收藏', '点赞', '转发'],
  allowedHosts: [
    'channels.weixin.qq.com',
    'res.wx.qq.com',
    'finder.video.qq.com',
    '*.video.qq.com',
    '*.weixin.qq.com',
    '*.wx.qq.com'
  ]
};

export async function loadSettings(settingsFile) {
  try {
    const raw = await fs.readFile(settingsFile, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settingsFile, settings) {
  await fs.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
