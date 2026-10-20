import { open } from 'node:fs/promises';

const SECTOR = 2048;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  return crc >>> 0;
});

export class IsoError extends Error {}

export async function inspectIso(path) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    async function read(offset, length) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > size) {
        throw new IsoError('A imagem está truncada ou contém uma referência fora do arquivo.');
      }
      const buffer = Buffer.alloc(length);
      let done = 0;
      while (done < length) {
        const { bytesRead } = await file.read(buffer, done, length - done, offset + done);
        if (!bytesRead) throw new IsoError('Não foi possível ler a imagem completa.');
        done += bytesRead;
      }
      return buffer;
    }
    function record(buffer, start) {
      const length = buffer[start];
      if (length < 34 || start + length > buffer.length) throw new IsoError('Registro de diretório ISO9660 inválido.');
      const extent = buffer.readUInt32LE(start + 2);
      const bytes = buffer.readUInt32LE(start + 10);
      if (extent !== buffer.readUInt32BE(start + 6) || bytes !== buffer.readUInt32BE(start + 14)) {
        throw new IsoError('Os campos de tamanho da imagem ISO9660 não conferem.');
      }
      const nameLength = buffer[start + 32];
      if (33 + nameLength > length) throw new IsoError('Nome de arquivo inválido na imagem.');
      const name = buffer.toString('ascii', start + 33, start + 33 + nameLength).replace(/;\d+$/, '');
      if (extent * SECTOR + bytes > size) throw new IsoError('Um arquivo do disco aponta para fora da imagem.');
      return { extent, bytes, name, directory: Boolean(buffer[start + 25] & 2) };
    }
    let descriptor;
    for (let sector = 16; sector < 80 && (sector + 1) * SECTOR <= size; sector++) {
      const block = await read(sector * SECTOR, SECTOR);
      if (block.toString('ascii', 1, 6) !== 'CD001' || block[6] !== 1) throw new IsoError('Selecione uma ISO9660 de PS2 em setores de 2048 bytes. PKG, CHD e imagens comprimidas não são aceitos.');
      if (block[0] === 1) { descriptor = block; break; }
      if (block[0] === 255) break;
    }
    if (!descriptor) throw new IsoError('Não foi encontrado um volume ISO9660 na imagem.');
    if (descriptor.readUInt16LE(128) !== SECTOR || descriptor.readUInt16BE(130) !== SECTOR) {
      throw new IsoError('A ISO precisa usar setores lógicos de 2048 bytes.');
    }
    const root = record(descriptor, 156);
    if (!root.directory) throw new IsoError('A raiz da ISO não é um diretório.');
    async function entries(directory) {
      if (directory.bytes > 4 * 1024 * 1024) throw new IsoError('Diretório ISO maior que o limite de análise.');
      const buffer = await read(directory.extent * SECTOR, directory.bytes);
      const result = [];
      for (let cursor = 0; cursor < buffer.length;) {
        if (!buffer[cursor]) { cursor = (Math.floor(cursor / SECTOR) + 1) * SECTOR; continue; }
        const entry = record(buffer, cursor);
        result.push(entry);
        cursor += buffer[cursor];
      }
      return result;
    }
    const rootEntries = await entries(root);
    const system = rootEntries.find(entry => entry.name.toUpperCase() === 'SYSTEM.CNF' && !entry.directory);
    if (!system || system.bytes > 64 * 1024) throw new IsoError('SYSTEM.CNF de PS2 não foi encontrado ou é inválido.');
    const config = (await read(system.extent * SECTOR, system.bytes)).toString('ascii');
    const boot = /^\s*BOOT2\s*=\s*cdrom0:\\?([^\r\n]+?)\s*$/im.exec(config)?.[1];
    if (!boot) throw new IsoError('A imagem não declara um executável BOOT2 de PlayStation 2.');
    const parts = boot.replace(/;\d+$/, '').split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.length > 16 || parts.some(part => part === '.' || part === '..' || !/^[A-Za-z0-9_.-]+$/.test(part))) {
      throw new IsoError('O caminho BOOT2 do disco é inválido.');
    }
    let list = rootEntries;
    let executable;
    for (let index = 0; index < parts.length; index++) {
      executable = list.find(entry => entry.name.toUpperCase() === parts[index].toUpperCase());
      if (!executable) throw new IsoError('O executável declarado no SYSTEM.CNF não existe no disco.');
      if (index < parts.length - 1) {
        if (!executable.directory) throw new IsoError('O caminho do executável passa por um arquivo.');
        list = await entries(executable);
      }
    }
    if (executable.directory || executable.bytes < 52 || executable.bytes > 64 * 1024 * 1024) throw new IsoError('Tamanho do executável de PS2 inválido.');
    const header = await read(executable.extent * SECTOR, 52);
    if (header.toString('hex', 0, 4) !== '7f454c46' || header[4] !== 1 || header[5] !== 1 || header.readUInt16LE(18) !== 8) {
      throw new IsoError('O executável não é um ELF32 MIPS little-endian de PS2.');
    }
    let crc = 0xFFFFFFFF;
    for (let offset = 0; offset < executable.bytes; offset += 1024 * 1024) {
      const block = await read(executable.extent * SECTOR + offset, Math.min(1024 * 1024, executable.bytes - offset));
      for (const byte of block) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    }
    const serial = parts.at(-1).toUpperCase();
    const region = /^(SLUS|SCUS)/.test(serial) ? 'EUA' : /^(SLES|SCES)/.test(serial) ? 'Europa' : /^(SLPM|SLPS|SCPS)/.test(serial) ? 'Japão' : 'Não identificada';
    return {
      sizeBytes: size,
      volumeId: descriptor.toString('ascii', 40, 72).trim(),
      platform: 'PlayStation 2', serial, region,
      executable: { path: parts.join('/'), sizeBytes: executable.bytes, crc32: ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0') },
      containsGameData: rootEntries.some(entry => entry.name.toUpperCase() === 'DATA.CVM' && !entry.directory),
    };
  } finally {
    await file.close();
  }
}
