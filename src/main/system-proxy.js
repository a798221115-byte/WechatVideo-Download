import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const INTERNET_SETTINGS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

async function reg(args) {
  const { stdout } = await execFileAsync('reg.exe', args, { windowsHide: true });
  return stdout;
}

function parseRegValue(output, name) {
  const line = output.split(/\r?\n/).find((item) => item.trim().startsWith(name));
  if (!line) return '';
  const parts = line.trim().split(/\s{2,}/);
  return parts[2] || '';
}

export async function readProxySnapshot() {
  if (process.platform !== 'win32') return { platform: process.platform, unsupported: true };
  const output = await reg(['query', INTERNET_SETTINGS_KEY, '/v', 'ProxyEnable']);
  let serverOutput = '';
  try {
    serverOutput = await reg(['query', INTERNET_SETTINGS_KEY, '/v', 'ProxyServer']);
  } catch {
    serverOutput = '';
  }
  return {
    platform: 'win32',
    proxyEnable: parseRegValue(output, 'ProxyEnable') || '0x0',
    proxyServer: parseRegValue(serverOutput, 'ProxyServer')
  };
}

export async function enableSystemProxy(port) {
  if (process.platform !== 'win32') return { skipped: true };
  await reg(['add', INTERNET_SETTINGS_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
  await reg(['add', INTERNET_SETTINGS_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `http=127.0.0.1:${port};https=127.0.0.1:${port}`, '/f']);
  return { skipped: false };
}

export async function restoreSystemProxy(snapshot) {
  if (!snapshot || snapshot.unsupported || process.platform !== 'win32') return { skipped: true };
  const enabled = snapshot.proxyEnable === '0x1' || snapshot.proxyEnable === '1';
  await reg(['add', INTERNET_SETTINGS_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', enabled ? '1' : '0', '/f']);
  if (snapshot.proxyServer) {
    await reg(['add', INTERNET_SETTINGS_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', snapshot.proxyServer, '/f']);
  }
  return { skipped: false };
}
