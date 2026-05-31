import { isAllowedUrl } from '../shared/security.js';

function normalizeUrlKey(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return String(value || '').split('?')[0].toLowerCase();
  }
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function textMatches(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

export function createMediaStore({ maxAgeMs = 15 * 60 * 1000, maxEntries = 800 } = {}) {
  let entries = [];

  function prune() {
    const cutoff = Date.now() - maxAgeMs;
    entries = entries.filter((item) => Number(item.capturedAt || 0) >= cutoff).slice(0, maxEntries);
  }

  return {
    remember(entry) {
      if (!entry?.url || !isAllowedUrl(entry.url)) return false;
      prune();
      const key = normalizeUrlKey(entry.url);
      if (entries.some((item) => normalizeUrlKey(item.url) === key)) return false;
      entries.unshift({
        videoId: entry.videoId || '',
        title: entry.title || '',
        coverUrl: entry.coverUrl || '',
        objectId: entry.objectId || '',
        url: entry.url,
        capturedAt: Date.now()
      });
      prune();
      return true;
    },
    enrich(item, options = {}) {
      if (item.url && isAllowedUrl(item.url)) return item;
      prune();
      const coverKey = normalizeUrlKey(item.coverUrl);
      const matched = entries.find((entry) => {
        if (item.videoId && entry.videoId && item.videoId === entry.videoId) return true;
        if (item.objectId && entry.objectId && item.objectId === entry.objectId) return true;
        if (coverKey && normalizeUrlKey(entry.coverUrl) === coverKey) return true;
        if (textMatches(item.title, entry.title)) return true;
        return false;
      });
      if (matched?.url) return { ...item, url: matched.url };
      if (options.allowRecentFallback && entries[0]?.url) {
        return { ...item, url: entries[0].url };
      }
      return item;
    },
    list() {
      prune();
      return entries.map((entry) => ({ ...entry }));
    },
    summary() {
      prune();
      const latest = entries[0];
      return {
        count: entries.length,
        latestCapturedAt: latest?.capturedAt || 0,
        latestHost: latest?.url ? new URL(latest.url).hostname : '',
        latestPath: latest?.url ? new URL(latest.url).pathname : ''
      };
    }
  };
}
