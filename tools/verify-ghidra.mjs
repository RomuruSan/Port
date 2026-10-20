import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeElf } from '../support/elf-fixture.js';
import { inspectBinary } from '../src/binary.js';
import { checkTools, decompileArtifact } from '../src/ghidra.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tools = await checkTools();
if (!tools.ready) throw new Error('Configure PORT_RE_GHIDRA_DIR e um JDK compatível.');
const working = await mkdtemp(join(process.env.PORT_RE_TEST_DIR || tmpdir(), 'port-re-ghidra-'));
for (const [name, ppc] of [['mips', false], ['ppc64', true]]) {
  const source = join(working, `${name}.elf`);
  await writeFile(source, makeElf({ ppc }));
  const artifact = { ...(await inspectBinary(source)), sourcePath: source };
  const result = await decompileArtifact({ artifact, tools, outputDir: join(working, name), scriptDir: join(root, 'ghidra_scripts'), maxFunctions: 100, onLog: line => process.stdout.write(line) });
  if (result.decompiled < 1 || !result.functions.some(f => f.decompiled && f.pseudocode.includes('return'))) throw new Error(`O Ghidra não decompilou o programa sintético ${name}.`);
  const assembly = await readFile(join(result.exportDir, 'disassembly.txt'), 'utf8');
  if (!assembly.includes('00100000')) throw new Error('Assembly exportado não corresponde ao programa sintético.');
  console.log(JSON.stringify({ target: name, discovered: result.discovered, decompiled: result.decompiled, failed: result.failed, output: result.outputDir }));
}
console.log('Decompilação real de fixtures MIPS e PowerPC concluída; nenhum jogo foi usado.');
