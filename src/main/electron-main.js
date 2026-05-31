import { app, Menu, nativeImage, shell, Tray } from 'electron';
import path from 'node:path';
import { createApplication } from './app-core.js';

let tray = null;
let runtime = null;
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
}

function createTrayIcon() {
  const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) return icon.resize({ width: 32, height: 32 });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="7" fill="#242424"/><path d="M8 9l8 14 8-14" fill="none" stroke="#07c160" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function updateMenu() {
  const proxyRunning = runtime?.proxyService.isRunning();
  const menu = Menu.buildFromTemplate([
    {
      label: proxyRunning ? '停止代理' : '启动代理',
      click: async () => {
        if (!runtime) return;
        if (runtime.proxyService.isRunning()) {
          await runtime.proxyService.stop();
        } else {
          await runtime.proxyService.start();
        }
        updateMenu();
      }
    },
    {
      label: '打开控制台',
      click: () => shell.openExternal(runtime.localServer.url())
    },
    {
      label: '打开下载目录',
      click: () => shell.openPath(runtime.paths.downloadsDir)
    },
    {
      label: '恢复系统代理',
      click: async () => {
        if (runtime?.proxyService.isRunning()) await runtime.proxyService.stop();
        updateMenu();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: async () => {
        await app.quit();
      }
    }
  ]);
  tray.setToolTip(`视频号下载助手${proxyRunning ? '：代理运行中' : ''}`);
  tray.setContextMenu(menu);
}

async function openConsole() {
  if (runtime) await shell.openExternal(runtime.localServer.url());
}

function isAddressInUse(error) {
  return error?.code === 'EADDRINUSE' || String(error?.message || '').includes('EADDRINUSE');
}

app.on('second-instance', () => {
  void openConsole();
});

if (gotLock) app.whenReady().then(async () => {
  app.setName('视频号下载助手');
  runtime = await createApplication(process.cwd(), {
    openPath: (targetPath) => shell.openPath(targetPath)
  });
  try {
    await runtime.startLocalServer();
  } catch (error) {
    if (isAddressInUse(error)) {
      await shell.openExternal(`http://127.0.0.1:${runtime.settings.appPort}`);
      runtime = null;
      app.exit(0);
      return;
    }
    throw error;
  }
  tray = new Tray(createTrayIcon());
  updateMenu();
  await openConsole();
});

app.on('before-quit', async (event) => {
  if (!runtime) return;
  event.preventDefault();
  const current = runtime;
  runtime = null;
  await current.stop();
  app.exit(0);
});
