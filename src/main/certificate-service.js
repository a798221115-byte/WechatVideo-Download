import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function ensureCertificate(paths) {
  const keyPath = path.join(paths.certsDir, 'wx-helper-mockttp-root.key');
  const certPath = path.join(paths.certsDir, 'wx-helper-mockttp-root.cer');
  try {
    await fs.access(keyPath);
    await fs.access(certPath);
    return { keyPath, certPath };
  } catch {
    const { generateCACertificate } = await import('mockttp');
    const generated = await generateCACertificate({
      subject: {
        commonName: 'WX Channel Local Helper Root',
        organizationName: 'Local Only',
        countryName: 'CN'
      }
    });
    await fs.writeFile(keyPath, generated.key, 'utf8');
    await fs.writeFile(certPath, generated.cert, 'utf8');
    return { keyPath, certPath };
  }
}

export async function installCertificateForCurrentUser(certPath) {
  if (process.platform !== 'win32') {
    return { skipped: true, reason: 'certificate auto-install is only implemented for Windows' };
  }
  await execFileAsync('certutil.exe', ['-f', '-user', '-addstore', 'Root', certPath], {
    windowsHide: true,
    timeout: 8000
  });
  return { skipped: false };
}
