import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { packager } = require('@electron/packager');
const root = process.cwd();
const distDir = path.join(root, 'dist');
const iconPath = path.join(root, 'assets', 'icon.ico');
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const outDir = path.join(distDir, stamp);
const electronZipDir = path.join(
  process.env.LOCALAPPDATA || '',
  'electron',
  'Cache',
  'bc80a13ebe4734629db853b3fc870b18ba9e388b795710fdbbd075694e548d03'
);

const outputPaths = await packager({
  dir: root,
  name: '视频号下载助手',
  executableName: 'WxChannelHelper',
  platform: 'win32',
  arch: 'x64',
  out: outDir,
  icon: iconPath,
  electronZipDir,
  asar: true,
  prune: true,
  overwrite: false,
  ignore: [
    /^\/data($|\/)/,
    /^\/downloads($|\/)/,
    /^\/logs($|\/)/,
    /^\/tests($|\/)/,
    /^\/dist($|\/)/,
    /^\/\.git($|\/)/
  ]
});

console.log(`Packaged app: ${outputPaths.join('\n')}`);
