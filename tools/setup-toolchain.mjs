import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTools } from '../src/ghidra.js';
import { COMPONENTS, installComponent, installWindowsTools } from '../src/toolchain.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.env.PORT_RE_TOOL_CACHE || join(project, '..', '.cache', 'port-re', 'toolchain'));
await mkdir(root, { recursive: true });
let paths;
let last = 0;
const progress = value => {
  if (Date.now() - last < 2000 && value.phase !== 'extracting') return;
  last = Date.now();
  console.log(value.message || (value.phase === 'extracting' ? 'Checksum confirmado; extraindo…' : `Download: ${Math.round((value.downloaded || 0) / 1024 ** 2)} MiB`));
};
if (process.platform === 'win32') paths = await installWindowsTools(root, { onProgress: progress });
else {
  const configured = await checkTools();
  const ghidraDir = configured.ghidraAvailable ? configured.ghidraDir : await installComponent(COMPONENTS.ghidra, root, { onProgress: progress });
  paths = { ghidraDir, javaHome: configured.javaHome };
}
const checked = await checkTools(paths);
if (!checked.ready) throw new Error('As ferramentas foram preparadas, mas ainda falta um JDK compatível. Configure JAVA_HOME.');
await writeFile(join(root, 'paths.json'), JSON.stringify(paths, null, 2));
console.log(JSON.stringify({ ready: checked.ready, version: checked.ghidraVersion, pathsFile: join(root, 'paths.json') }));
