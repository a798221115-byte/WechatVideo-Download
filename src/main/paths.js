import fs from 'node:fs/promises';
import path from 'node:path';

export function getProjectRoot() {
  return process.cwd();
}

export function createAppPaths(root = getProjectRoot()) {
  return {
    root,
    dataDir: path.join(root, 'data'),
    downloadsDir: path.join(root, 'downloads'),
    logsDir: path.join(root, 'logs'),
    certsDir: path.join(root, 'data', 'certs'),
    recordsFile: path.join(root, 'data', 'records.jsonl'),
    settingsFile: path.join(root, 'data', 'settings.json')
  };
}

export async function ensureAppDirs(paths) {
  await fs.mkdir(paths.dataDir, { recursive: true });
  await fs.mkdir(paths.downloadsDir, { recursive: true });
  await fs.mkdir(paths.logsDir, { recursive: true });
  await fs.mkdir(paths.certsDir, { recursive: true });
}
