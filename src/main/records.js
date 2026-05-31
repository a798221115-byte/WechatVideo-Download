import fs from 'node:fs/promises';
import { redactSensitiveUrl } from '../shared/security.js';

export async function appendRecord(recordsFile, event) {
  const safeEvent = {
    ...event,
    url: event.url ? redactSensitiveUrl(event.url) : undefined,
    decryptKey: undefined,
    decryptorArray: undefined,
    time: event.time || new Date().toISOString()
  };
  await fs.appendFile(recordsFile, `${JSON.stringify(safeEvent)}\n`, 'utf8');
}

export async function readRecords(recordsFile, limit = 500) {
  try {
    const raw = await fs.readFile(recordsFile, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
}
