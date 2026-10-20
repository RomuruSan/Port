import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

export class AnalysisError extends Error {}
const hex = value => `0x${BigInt(value).toString(16).toUpperCase()}`;

export async function summarizeFile(path, { signal, onProgress = () => {}, maxStrings = 3000 } = {}) {
  const hash = createHash('sha256');
  const strings = [];
  let position = 0, start = 0, text = '';
  const stream = createReadStream(path, { highWaterMark: 256 * 1024, signal });
  for await (const chunk of stream) {
    hash.update(chunk);
    if (strings.length < maxStrings) for (let index = 0; index < chunk.length; index++) {
      const byte = chunk[index];
      if (byte >= 32 && byte <= 126) {
        if (!text) start = position + index;
        if (text.length < 256) text += String.fromCharCode(byte);
      } else {
        if (text.length >= 5) strings.push({ offset: hex(start), text });
        text = '';
        if (strings.length >= maxStrings) break;
      }
    }
    position += chunk.length;
    onProgress(position);
  }
  if (text.length >= 5 && strings.length < maxStrings) strings.push({ offset: hex(start), text });
  return { sha256: hash.digest('hex'), strings, stringsLimited: strings.length >= maxStrings, bytesHashed: position };
}

export async function inspectBinary(path) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    async function read(offset, length, limit = 16 * 1024 * 1024) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > limit || offset + length > size) throw new AnalysisError('O arquivo contém uma tabela truncada ou um tamanho inválido.');
      const buffer = Buffer.alloc(length);
      let done = 0;
      while (done < length) {
        const { bytesRead } = await file.read(buffer, done, length - done, offset + done);
        if (!bytesRead) throw new AnalysisError('Leitura incompleta do arquivo.');
        done += bytesRead;
      }
      return buffer;
    }
    const header = await read(0, Math.min(size, 64));
    if (header.subarray(0, 4).equals(Buffer.from([0x53, 0x43, 0x45, 0]))) {
      return { kind: 'self', platform: 'PS3', architecture: 'Contêiner SELF', sizeBytes: size, decompilable: false, warnings: ['O arquivo é um contêiner SELF. Sua assinatura não informa se o conteúdo está acessível; este aplicativo não descriptografa SELF. Forneça um ELF acessível para decompilar.'] };
    }
    if (header.subarray(0, 4).equals(Buffer.from([0x7F, 0x50, 0x4B, 0x47]))) return { kind: 'pkg', platform: 'PS3', architecture: 'Pacote PKG', sizeBytes: size, decompilable: false, warnings: ['PKG é um pacote, não código-fonte ou um executável ELF diretamente analisável.'] };
    if (header.toString('hex', 0, 4) !== '7f454c46') return { kind: 'raw', platform: 'Não identificada', architecture: 'Dados binários', sizeBytes: size, decompilable: false, warnings: ['Não há um cabeçalho ELF reconhecido. Strings e hash não identificam a lógica completa do programa.'] };
    const bits = header[4] === 1 ? 32 : header[4] === 2 ? 64 : 0;
    const little = header[5] === 1;
    if (!bits || ![1, 2].includes(header[5]) || size < (bits === 32 ? 52 : 64)) throw new AnalysisError('Cabeçalho ELF inválido.');
    const u16 = (b, o) => little ? b.readUInt16LE(o) : b.readUInt16BE(o);
    const u32 = (b, o) => little ? b.readUInt32LE(o) : b.readUInt32BE(o);
    const u64 = (b, o) => little ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o);
    const number = value => { if (BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) throw new AnalysisError('Offset ELF maior que o limite suportado.'); return Number(value); };
    const wide = (b, o) => bits === 32 ? BigInt(u32(b, o)) : u64(b, o);
    const machine = u16(header, 18);
    const architecture = machine === 8 ? 'MIPS / R5900 (instruções específicas de PS2 exigem suporte próprio)' : machine === 21 ? 'PowerPC 64 / PPU' : machine === 23 ? 'SPU' : `ELF machine ${machine}`;
    const platform = machine === 8 ? 'PS2 (candidato pelo processador)' : [21, 23].includes(machine) ? 'PS3 (candidato pelo processador)' : 'Não identificada';
    const phoff = number(wide(header, bits === 32 ? 28 : 32));
    const shoff = number(wide(header, bits === 32 ? 32 : 40));
    const phsize = u16(header, bits === 32 ? 42 : 54), phcount = u16(header, bits === 32 ? 44 : 56);
    const shsize = u16(header, bits === 32 ? 46 : 58), shcount = u16(header, bits === 32 ? 48 : 60), shstrings = u16(header, bits === 32 ? 50 : 62);
    if (phcount > 4096 || shcount > 8192 || (phcount && phsize < (bits === 32 ? 32 : 56)) || (shcount && shsize < (bits === 32 ? 40 : 64))) throw new AnalysisError('Tabelas ELF fora dos limites suportados.');
    const segments = [];
    if (phcount) {
      const table = await read(phoff, phsize * phcount);
      for (let i = 0; i < phcount; i++) {
        const p = table.subarray(i * phsize, (i + 1) * phsize);
        const offset = number(wide(p, bits === 32 ? 4 : 8));
        const bytes = number(wide(p, bits === 32 ? 16 : 32));
        if (offset + bytes > size) throw new AnalysisError('Segmento ELF aponta para fora do arquivo.');
        segments.push({ type: u32(p, 0), offset, size: bytes, memorySize: number(wide(p, bits === 32 ? 20 : 40)), address: hex(wide(p, bits === 32 ? 8 : 16)), flags: u32(p, bits === 32 ? 24 : 4) });
      }
    }
    const sections = [];
    if (shcount) {
      const table = await read(shoff, shsize * shcount);
      for (let i = 0; i < shcount; i++) {
        const p = table.subarray(i * shsize, (i + 1) * shsize);
        const section = { index: i, nameIndex: u32(p, 0), type: u32(p, 4), flags: hex(wide(p, 8)), address: hex(wide(p, bits === 32 ? 12 : 16)), offset: number(wide(p, bits === 32 ? 16 : 24)), size: number(wide(p, bits === 32 ? 20 : 32)), link: u32(p, bits === 32 ? 24 : 40), entrySize: number(wide(p, bits === 32 ? 36 : 56)) };
        if (section.type !== 8 && section.offset + section.size > size) throw new AnalysisError('Seção ELF aponta para fora do arquivo.');
        sections.push(section);
      }
      let names = Buffer.alloc(0);
      if (shstrings > 0 && shstrings < sections.length) names = await read(sections[shstrings].offset, sections[shstrings].size);
      for (const section of sections) {
        const end = names.indexOf(0, section.nameIndex);
        section.name = section.nameIndex < names.length ? names.toString('utf8', section.nameIndex, end >= 0 ? end : names.length).slice(0, 256) : '';
      }
    }
    const symbols = [];
    let symbolCount = 0;
    for (const section of sections.filter(s => [2, 11].includes(s.type))) {
      const minimum = bits === 32 ? 16 : 24;
      if (section.entrySize < minimum || !sections[section.link] || section.size % section.entrySize) throw new AnalysisError('Tabela de símbolos ELF inválida.');
      const total = section.size / section.entrySize;
      symbolCount += total;
      const stringsSection = sections[section.link];
      const names = await read(stringsSection.offset, stringsSection.size);
      const count = Math.min(total, 5000 - symbols.length);
      if (count <= 0) continue;
      const table = await read(section.offset, section.entrySize * count);
      for (let i = 0; i < count; i++) {
        const p = table.subarray(i * section.entrySize, (i + 1) * section.entrySize);
        const index = u32(p, 0), end = names.indexOf(0, index);
        const name = index < names.length ? names.toString('utf8', index, end >= 0 ? end : names.length).slice(0, 256) : '';
        if (name) symbols.push({ name, address: hex(wide(p, bits === 32 ? 4 : 8)), size: number(wide(p, bits === 32 ? 8 : 16)), type: p[bits === 32 ? 12 : 4] & 15 });
      }
    }
    return { kind: 'elf', platform, architecture, bits, endianness: little ? 'little-endian' : 'big-endian', machine, entrypoint: hex(wide(header, 24)), sizeBytes: size, segments, sections, symbols, symbolCount, symbolsLimited: symbolCount > 5000, decompilable: [8, 21, 23].includes(machine), warnings: [symbols.length ? 'Os símbolos abaixo são os que ainda existem no executável; eles não recuperam comentários ou arquivos-fonte removidos.' : 'Executável sem símbolos nomeados disponíveis. Nomes originais removidos na compilação não podem ser reconstruídos automaticamente.', ...(machine === 8 ? ['O decompilador genérico pode não reconhecer instruções MMI/VU do R5900. Extensões e revisão manual podem ser necessárias.'] : []), ...(machine === 23 ? ['SPU exige um módulo de processador compatível no Ghidra. A instalação padrão pode não oferecer esse módulo.'] : [])] };
  } finally { await file.close(); }
}

export async function inspectFirmware(path) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (size > 512 * 1024 * 1024) throw new AnalysisError('A inspeção de firmware aceita arquivos de até 512 MiB.');
    const buffer = Buffer.alloc(Math.min(size, 1024 * 1024));
    await file.read(buffer, 0, buffer.length, 0);
    for (let offset = 0; offset + 32 < buffer.length; offset += 16) {
      if (buffer.toString('ascii', offset, offset + 6) !== 'RESET\0' || buffer.toString('ascii', offset + 16, offset + 23) !== 'ROMDIR\0') continue;
      const entries = [];
      let dataOffset = 0;
      for (let i = 0; i < 1024 && offset + (i + 1) * 16 <= buffer.length; i++) {
        const row = buffer.subarray(offset + i * 16, offset + (i + 1) * 16);
        if (!row[0]) break;
        const name = row.subarray(0, 10).toString('ascii').replace(/\0.*$/, '');
        const bytes = row.readUInt32LE(12);
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || dataOffset + bytes > size) { entries.length = 0; break; }
        entries.push({ name, offset: dataOffset, size: bytes });
        dataOffset += Math.ceil(bytes / 16) * 16;
      }
      if (entries.length < 2 || entries[1].offset !== offset) continue;
      const version = entries.find(e => e.name === 'ROMVER');
      let romVersion = '';
      if (version && version.size <= 256) {
        const bytes = Buffer.alloc(version.size);
        await file.read(bytes, 0, bytes.length, version.offset);
        romVersion = bytes.toString('ascii').replace(/\0.*$/, '').trim();
      }
      return { kind: 'ps2-bios', platform: 'PS2', architecture: 'ROM de firmware com ROMDIR', romVersion, entries, sizeBytes: size, decompilable: false, warnings: ['Esta ROM contém firmware do console, não o código-fonte dos jogos. Os módulos identificados ainda precisam de análise específica; eles não são decompilados automaticamente como um ELF.'] };
    }
    return { kind: 'firmware-unknown', platform: 'Não confirmada', architecture: 'Dump binário de firmware', sizeBytes: size, decompilable: false, entries: [], warnings: ['Nenhuma ROMDIR de PS2 válida foi encontrada. Um dump de flash de PS3 não equivale a uma BIOS de PS2 e pode conter regiões assinadas ou criptografadas. Este aplicativo não as descriptografa.', 'Tamanho e strings, isoladamente, não confirmam modelo ou versão de firmware e não recuperam código-fonte de jogos.'] };
  } finally { await file.close(); }
}
