import { makeElf } from './elf-fixture.js';

export function makeSfo() {
  const fields = [['TITLE', 'Synthetic Console Test'], ['TITLE_ID', 'TEST00001']];
  const keys = Buffer.from(fields.map(([key]) => key + '\0').join(''));
  const keyOffset = 20 + fields.length * 16;
  const valuesOffset = Math.ceil((keyOffset + keys.length) / 4) * 4;
  const values = fields.map(([, value]) => Buffer.from(value + '\0'));
  const result = Buffer.alloc(valuesOffset + values.reduce((n, b) => n + Math.ceil(b.length / 4) * 4, 0));
  result.writeUInt32LE(0x46535000, 0); result.writeUInt32LE(0x101, 4);
  result.writeUInt32LE(keyOffset, 8); result.writeUInt32LE(valuesOffset, 12); result.writeUInt32LE(fields.length, 16);
  keys.copy(result, keyOffset);
  let k = 0, v = 0;
  fields.forEach(([key], i) => {
    const row = 20 + i * 16, value = values[i];
    result.writeUInt16LE(k, row); result.writeUInt16LE(0x204, row + 2); result.writeUInt32LE(value.length, row + 4);
    result.writeUInt32LE(Math.ceil(value.length / 4) * 4, row + 8); result.writeUInt32LE(v, row + 12);
    value.copy(result, valuesOffset + v); k += key.length + 1; v += Math.ceil(value.length / 4) * 4;
  });
  return result;
}

export function makeDisc({ ps3 = false, self = false, extraFiles = {} } = {}) {
  const files = ps3 ? { 'PS3_GAME/PARAM.SFO': makeSfo(), 'PS3_GAME/USRDIR/EBOOT.BIN': self ? Buffer.from('SCE\0' + '0'.repeat(60)) : makeElf({ ppc: true }) } : { 'SYSTEM.CNF': Buffer.from('BOOT2 = cdrom0:\\SLUS_000.00;1\r\nVER = 1.00\r\n'), 'SLUS_000.00': makeElf() };
  Object.assign(files, extraFiles);
  const root = { name: '', parent: null, children: [], sector: 20, directory: true };
  root.parent = root;
  const directories = [root], content = [];
  for (const [path, buffer] of Object.entries(files)) {
    const parts = path.split('/'); let current = root;
    for (const part of parts.slice(0, -1)) {
      let next = current.children.find(c => c.name === part);
      if (!next) { next = { name: part, parent: current, children: [], directory: true, sector: 20 + directories.length }; directories.push(next); current.children.push(next); }
      current = next;
    }
    const file = { name: parts.at(-1), buffer, directory: false }; current.children.push(file); content.push(file);
  }
  let sector = 20 + directories.length;
  for (const file of content) { file.sector = sector; sector += Math.max(1, Math.ceil(file.buffer.length / 2048)); }
  const image = Buffer.alloc(Math.max(32, sector) * 2048);
  function record(item, special) {
    const name = special !== undefined ? String.fromCharCode(special) : item.name + (item.directory ? '' : ';1');
    const length = 33 + name.length + (name.length % 2 === 0 ? 1 : 0), result = Buffer.alloc(length);
    result[0] = length; result.writeUInt32LE(item.sector, 2); result.writeUInt32BE(item.sector, 6);
    const size = item.directory ? 2048 : item.buffer.length;
    result.writeUInt32LE(size, 10); result.writeUInt32BE(size, 14);
    Buffer.from([126, 10, 20, 0, 0, 0, 0]).copy(result, 18);
    result[25] = item.directory ? 2 : 0; result.writeUInt16LE(1, 28); result.writeUInt16BE(1, 30);
    result[32] = name.length; result.write(name, 33, 'ascii'); return result;
  }
  const pvd = image.subarray(16 * 2048, 17 * 2048);
  pvd[0] = 1; pvd.write('CD001', 1); pvd[6] = 1;
  pvd.fill(32, 8, 72); pvd.write('PLAYSTATION', 8); pvd.write('SYNTHETIC_TEST', 40);
  pvd.writeUInt32LE(image.length / 2048, 80); pvd.writeUInt32BE(image.length / 2048, 84);
  pvd.writeUInt16LE(1, 120); pvd.writeUInt16BE(1, 122); pvd.writeUInt16LE(1, 124); pvd.writeUInt16BE(1, 126);
  pvd.writeUInt16LE(2048, 128); pvd.writeUInt16BE(2048, 130); pvd[881] = 1;
  const pathTables = [false, true].map(big => Buffer.concat(directories.map(directory => {
    const name = directory === root ? '\0' : directory.name;
    const row = Buffer.alloc(8 + name.length + (name.length % 2)); row[0] = name.length;
    big ? row.writeUInt32BE(directory.sector, 2) : row.writeUInt32LE(directory.sector, 2);
    big ? row.writeUInt16BE(directories.indexOf(directory.parent) + 1, 6) : row.writeUInt16LE(directories.indexOf(directory.parent) + 1, 6);
    row.write(name, 8, 'ascii'); return row;
  })));
  pvd.writeUInt32LE(pathTables[0].length, 132); pvd.writeUInt32BE(pathTables[0].length, 136);
  pvd.writeUInt32LE(18, 140); pvd.writeUInt32BE(19, 148);
  pathTables[0].copy(image, 18 * 2048); pathTables[1].copy(image, 19 * 2048);
  record(root, 0).copy(pvd, 156);
  const terminator = image.subarray(17 * 2048, 18 * 2048); terminator[0] = 255; terminator.write('CD001', 1); terminator[6] = 1;
  for (const directory of directories) Buffer.concat([record(directory, 0), record(directory.parent, 1), ...directory.children.map(item => record(item))]).copy(image, directory.sector * 2048);
  for (const file of content) file.buffer.copy(image, file.sector * 2048);
  return image;
}

export function makeFirmware() {
  const buffer = Buffer.alloc(4096);
  const entries = [['RESET', 256], ['ROMDIR', 64], ['ROMVER', 14]];
  entries.forEach(([name, bytes], index) => { const offset = 256 + index * 16; buffer.write(name, offset); buffer.writeUInt32LE(bytes, offset + 12); });
  buffer.write('0200EC20040614', 320);
  return buffer;
}
