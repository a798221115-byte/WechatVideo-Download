import { appendRecord as appendRecordToFile } from './records.js';
import { createAppPaths, ensureAppDirs } from './paths.js';
import { loadSettings, saveSettings } from './settings.js';
import { createDownloadQueue } from './download-queue.js';
import { createDownloader } from './downloader.js';
import { createLocalServer } from './local-server.js';
import { createProxyService } from './proxy-service.js';

export async function createApplication(root = process.cwd(), options = {}) {
  const paths = createAppPaths(root);
  await ensureAppDirs(paths);
  const settings = await loadSettings(paths.settingsFile);
  await saveSettings(paths.settingsFile, settings);
  const queue = createDownloadQueue();
  const appendRecord = (event) => appendRecordToFile(paths.recordsFile, event);
  const downloader = createDownloader({
    queue,
    paths,
    appendRecord,
    concurrency: settings.downloadConcurrency
  });
  const proxyService = createProxyService({ settings, paths, appendRecord });
  const localServer = createLocalServer({
    settings,
    paths,
    queue,
    downloader,
    proxyService,
    appendRecord,
    openPath: options.openPath
  });

  return {
    settings,
    paths,
    queue,
    downloader,
    localServer,
    proxyService,
    async startLocalServer() {
      return localServer.start(settings.appPort);
    },
    async stop() {
      downloader.stop();
      await proxyService.stop();
      await localServer.stop();
    }
  };
}
