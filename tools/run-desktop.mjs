import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = resolve(root, '..', '.cache', 'port-re');
await mkdir(cache, { recursive: true });
const env = { ...process.env, PORT_RE_DATA_DIR: process.env.PORT_RE_DATA_DIR || join(cache, 'dev-data') };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const paths = JSON.parse(await readFile(join(cache, 'toolchain', 'paths.json'), 'utf8'));
  env.PORT_RE_GHIDRA_DIR ||= paths.ghidraDir;
  if (paths.javaHome) env.JAVA_HOME ||= paths.javaHome;
} catch { /* Optional development toolchain has not been configured. */ }
if (process.platform === 'linux') {
  env.XDG_CONFIG_HOME ||= join(cache, 'xdg-config'); env.XDG_CACHE_HOME ||= join(cache, 'xdg-cache');
}
const args = [root, ...process.argv.slice(2)];
if (process.env.PORT_RE_DISABLE_SANDBOX === '1' && process.platform === 'linux') args.push('--no-sandbox');
const child = spawn(require('electron'), args, { stdio: 'inherit', env });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('close', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
