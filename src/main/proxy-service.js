import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCertificate, installCertificateForCurrentUser } from './certificate-service.js';
import { enableSystemProxy, readProxySnapshot, restoreSystemProxy } from './system-proxy.js';
import { isAllowedUrl } from '../shared/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const injectedScriptPath = path.resolve(__dirname, '..', 'injected', 'page-helper.js');

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '');
}

function headerValue(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) return firstHeaderValue(value);
  }
  return '';
}

function stripPort(host) {
  return String(host || '').replace(/:\d+$/, '').toLowerCase();
}

export function getRequestHost(req) {
  try {
    const parsed = new URL(req.url);
    return parsed.hostname;
  } catch {
    return stripPort(req.destination?.hostname || headerValue(req.headers, ':authority') || headerValue(req.headers, 'host'));
  }
}

export function getRequestUrl(req) {
  try {
    return new URL(req.url);
  } catch {
    const host = getRequestHost(req);
    const requestPath = req.path || headerValue(req.headers, ':path') || req.url || '/';
    if (!host) return undefined;
    try {
      return new URL(`${req.protocol || 'https'}://${host}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`);
    } catch {
      return undefined;
    }
  }
}

export function isChannelsPageRequest(req) {
  const parsed = getRequestUrl(req);
  return parsed?.hostname === 'channels.weixin.qq.com' && parsed.pathname.startsWith('/web/pages/');
}

export function isChannelsHostRequest(req) {
  return getRequestHost(req) === 'channels.weixin.qq.com';
}

function looksLikeHtml(text) {
  return /<\/head>/i.test(text) || /<html[\s>]/i.test(text) || /<!doctype\s+html/i.test(text);
}

function removeBlockingHeaders(headers) {
  const nextHeaders = { ...headers };
  for (const key of Object.keys(nextHeaders)) {
    const normalized = key.toLowerCase();
    if (
      normalized === 'content-length' ||
      normalized === 'content-security-policy' ||
      normalized === 'content-security-policy-report-only'
    ) {
      delete nextHeaders[key];
    }
  }
  return nextHeaders;
}

export function scanTextForMediaUrls(text) {
  const urls = [];
  const seen = new Set();
  function addCandidate(raw) {
    const url = raw.replaceAll('\\/', '/').replaceAll('&amp;', '&').replace(/[),.;\]}]+$/, '');
    if (!isLikelyMediaRequestUrl(url) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  }
  const source = String(text || '');
  const scanSources = new Set([
    source,
    source
      .replaceAll('\\u002F', '/')
      .replaceAll('\\u002f', '/')
      .replaceAll('\\u003A', ':')
      .replaceAll('\\u003a', ':')
      .replaceAll('&amp;', '&')
  ]);
  for (const scanSource of scanSources) {
    const matches = scanSource.match(/https?:\\?\/\\?\/[^"'\s<>]+/g) || [];
    for (const raw of matches) {
      addCandidate(raw);
    }
    const encodedMatches = scanSource.match(/https?%3A%2F%2F[^"'\s<>]+/gi) || [];
    for (const raw of encodedMatches) {
      try {
        addCandidate(decodeURIComponent(raw));
      } catch {
        // Ignore malformed percent-encoded fragments.
      }
    }
  }
  return urls;
}

function parseProxyServerValue(proxyServer) {
  const value = String(proxyServer || '').trim();
  if (!value) return '';
  const entries = new Map();
  for (const part of value.split(';')) {
    const [rawKey, ...rest] = part.split('=');
    if (!rest.length) continue;
    entries.set(rawKey.trim().toLowerCase(), rest.join('=').trim());
  }
  return entries.get('https') || entries.get('http') || value;
}

export function proxyConfigFromSnapshot(snapshot, helperPort) {
  if (!snapshot || snapshot.unsupported) return undefined;
  const enabled = snapshot.proxyEnable === '0x1' || snapshot.proxyEnable === '1' || snapshot.proxyEnable === 1;
  if (!enabled) return undefined;
  const server = parseProxyServerValue(snapshot.proxyServer);
  if (!server) return undefined;
  if (server.includes(`127.0.0.1:${helperPort}`) || server.includes(`localhost:${helperPort}`)) return undefined;
  const proxyUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(server) ? server : `http://${server}`;
  return {
    proxyUrl,
    noProxy: ['127.0.0.1', 'localhost']
  };
}

export function tlsInterceptTargets() {
  return [
    { hostname: 'channels.weixin.qq.com' },
    { hostname: 'finder.video.qq.com' },
    { hostname: 'finder.video.weixin.qq.com' },
    { hostname: '*.video.qq.com' },
    { hostname: '*.tc.qq.com' },
    { hostname: '*.weixin.qq.com' },
    { hostname: '*.wx.qq.com' }
  ];
}

export function isLikelyMediaRequestUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (!isAllowedUrl(value)) return false;
    if (!(
      host === 'finder.video.qq.com' ||
      host === 'finder.video.weixin.qq.com' ||
      host.endsWith('.video.qq.com') ||
      host.endsWith('.tc.qq.com') ||
      host.endsWith('.weixin.qq.com') ||
      host.endsWith('.wx.qq.com')
    )) {
      return false;
    }
    return path.includes('.mp4') || path.includes('/video/') || path.includes('videoplayback') || parsed.searchParams.size > 0;
  } catch {
    return false;
  }
}

async function rememberProxyMediaRequest(req, mediaStore, appendRecord) {
  const url = getRequestUrl(req)?.toString();
  if (!url || !isLikelyMediaRequestUrl(url)) return;
  const accepted = mediaStore?.remember?.({ url }) || false;
  if (accepted) {
    await appendRecord({ type: 'proxy_media_seen', url });
  }
}

async function rememberMediaUrlsFromText(text, mediaStore, appendRecord) {
  let accepted = 0;
  for (const url of scanTextForMediaUrls(text)) {
    if (mediaStore?.remember?.({ url })) accepted += 1;
  }
  if (accepted) {
    await appendRecord({ type: 'proxy_media_urls_seen', count: accepted });
  }
}

export async function inspectChannelsResponse(req, res, appPort, appendRecord, mediaStore) {
  const contentType = headerValue(res.headers, 'content-type').toLowerCase();
  const text = await res.body.getText();
  const url = getRequestUrl(req)?.toString() || req.url;
  const diagnostic = {
    type: 'page_injection_checked',
    url,
    statusCode: res.statusCode,
    contentType,
    bodyLength: text.length,
    hasHead: /<\/head>/i.test(text)
  };

  if (!text) {
    await appendRecord({ ...diagnostic, result: 'skipped_empty_body' });
    return undefined;
  }

  await rememberMediaUrlsFromText(text, mediaStore, appendRecord);

  if (req.method !== 'GET') {
    await appendRecord({ ...diagnostic, result: 'skipped_non_get_after_scan' });
    return undefined;
  }

  if (text.includes('__WX_CHANNEL_LOCAL_HELPER__')) {
    await appendRecord({ ...diagnostic, result: 'skipped_already_injected' });
    return undefined;
  }

  if (!looksLikeHtml(text)) {
    await appendRecord({ ...diagnostic, result: 'skipped_not_html_body' });
    return undefined;
  }

  const helperSource = await fs.readFile(injectedScriptPath, 'utf8');
  const script = `<script>window.__WX_HELPER_APP_BASE__="http://127.0.0.1:${appPort}";\n${helperSource}</script>`;
  let body = `${text}${script}`;
  if (/<\/body>/i.test(text)) {
    body = text.replace(/<\/body>/i, `${script}</body>`);
  } else if (/<\/head>/i.test(text)) {
    body = text.replace(/<\/head>/i, `${script}</head>`);
  }
  await appendRecord({ ...diagnostic, result: 'injected' });
  return {
    headers: removeBlockingHeaders(res.headers),
    body
  };
}

export function createProxyService({ settings, paths, appendRecord, mediaStore }) {
  let mockServer = null;
  let proxySnapshot = null;

  function getRunningPort() {
    if (!mockServer) return 0;
    try {
      return mockServer.port;
    } catch {
      mockServer = null;
      return 0;
    }
  }

  return {
    async start() {
      const existingPort = getRunningPort();
      if (existingPort) {
        await enableSystemProxy(settings.proxyPort);
        return { running: true, port: existingPort };
      }

      const certificate = await ensureCertificate(paths);
      if (settings.autoInstallCertificate) {
        try {
          await installCertificateForCurrentUser(certificate.certPath);
        } catch (error) {
          await appendRecord({
            type: 'certificate_install_failed',
            certPath: certificate.certPath,
            error: error.message
          });
        }
      }

      let mockttp;
      try {
        mockttp = await import('mockttp');
      } catch (error) {
        throw new Error(`Mockttp failed to load: ${error.message}`);
      }

      const server = mockttp.getLocal({
        https: {
          keyPath: certificate.keyPath,
          certPath: certificate.certPath,
          tlsInterceptOnly: tlsInterceptTargets()
        },
        http2: 'fallback'
      });

      try {
        proxySnapshot = await readProxySnapshot();
        const upstreamProxy = proxyConfigFromSnapshot(proxySnapshot, settings.proxyPort);
        await server.start(settings.proxyPort);
        await server.forAnyRequest().thenPassThrough({
          proxyConfig: upstreamProxy,
          beforeRequest: async (req) => {
            await rememberProxyMediaRequest(req, mediaStore, appendRecord);
          },
          beforeResponse: async (res, req) => {
            if (isChannelsHostRequest(req)) {
              return inspectChannelsResponse(req, res, settings.appPort, appendRecord, mediaStore);
            }
            return undefined;
          }
        });

        await enableSystemProxy(settings.proxyPort);
        mockServer = server;
        await appendRecord({
          type: 'proxy_started',
          port: settings.proxyPort,
          upstreamProxy: upstreamProxy?.proxyUrl || ''
        });
      } catch (error) {
        try {
          await server.stop();
        } catch {
          // The server may not have started; the original error is more useful.
        }
        mockServer = null;
        throw error;
      }
      return { running: true, port: settings.proxyPort };
    },
    status() {
      return {
        running: Boolean(getRunningPort()),
        port: settings.proxyPort
      };
    },
    async stop() {
      await restoreSystemProxy(proxySnapshot);
      proxySnapshot = null;
      if (mockServer) {
        await mockServer.stop();
        mockServer = null;
      }
      await appendRecord({ type: 'proxy_stopped' });
    },
    isRunning() {
      return Boolean(mockServer);
    }
  };
}
