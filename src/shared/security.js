const EXACT_ALLOWED_HOSTS = new Set([
  'channels.weixin.qq.com',
  'res.wx.qq.com',
  'finder.video.qq.com',
  'finder.video.weixin.qq.com',
  'mp.weixin.qq.com'
]);

const ALLOWED_SUFFIXES = [
  '.video.qq.com',
  '.tc.qq.com',
  '.weixin.qq.com',
  '.wx.qq.com'
];

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'key',
  'authkey',
  'authorization',
  'cookie',
  'session',
  'signature',
  'sign',
  'exportkey',
  'pass_ticket',
  'context_id',
  'from_access_id',
  'x-snsvideoflag'
]);

export function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '');
}

export function isAllowedHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  if (EXACT_ALLOWED_HOSTS.has(normalized)) return true;
  return ALLOWED_SUFFIXES.some((suffix) => normalized.endsWith(suffix) && normalized.length > suffix.length);
}

export function isAllowedUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return isAllowedHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function redactSensitiveUrl(value) {
  try {
    const parsed = new URL(value);
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, 'REDACTED');
      }
    }
    return parsed.toString();
  } catch {
    return String(value || '');
  }
}

export function isChannelsPageUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === 'channels.weixin.qq.com' && parsed.pathname.startsWith('/web/pages/');
  } catch {
    return false;
  }
}
