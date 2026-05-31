const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
]);

export function sanitizeSegment(value, fallback = 'untitled') {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
    .trim();

  const result = cleaned || fallback;
  return RESERVED_NAMES.has(result.toUpperCase()) ? `${result}_` : result;
}

export function getDatePrefix(value) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

export function buildDownloadRelativePath(task) {
  const author = sanitizeSegment(task.author || task.nickname || 'unknown-author', 'unknown-author');
  const title = sanitizeSegment(task.title || task.description || 'video', 'video');
  const videoId = sanitizeSegment(task.videoId || task.id || 'unknown-id', 'unknown-id');
  const date = getDatePrefix(task.capturedAt || task.createdAt);
  return `${author}/${date}_${title}_${videoId}.mp4`;
}
