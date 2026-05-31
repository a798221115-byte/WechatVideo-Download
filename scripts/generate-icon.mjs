import fs from 'node:fs/promises';
import pngToIco from 'png-to-ico';

const ico = await pngToIco('assets/icon.png');
await fs.writeFile('assets/icon.ico', ico);
console.log(`Generated assets/icon.ico (${ico.length} bytes)`);
