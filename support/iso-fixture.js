// Synthetic filesystem data only; no game files are included.
export function makeIso({ serial = 'SLUS_210.75', machine = 8, boot = true } = {}) {
  const sector = 2048;
  const image = Buffer.alloc(sector * 32);
  const pvd = image.subarray(sector * 16, sector * 17);
  pvd[0] = 1;
  pvd.write('CD001', 1, 'ascii'); pvd[6] = 1;
  pvd.write('TEST DISC', 40, 'ascii');
  pvd.writeUInt16LE(sector, 128); pvd.writeUInt16BE(sector, 130);
  function record(name, extent, size, directory = false) {
    const length = 33 + name.length + (name.length % 2 === 0 ? 1 : 0);
    const buffer = Buffer.alloc(length);
    buffer[0] = length;
    buffer.writeUInt32LE(extent, 2); buffer.writeUInt32BE(extent, 6);
    buffer.writeUInt32LE(size, 10); buffer.writeUInt32BE(size, 14);
    buffer[25] = directory ? 2 : 0;
    buffer.writeUInt16LE(1, 28); buffer.writeUInt16BE(1, 30);
    buffer[32] = name.length; buffer.write(name, 33, 'ascii');
    return buffer;
  }
  record('\x00', 20, sector, true).copy(pvd, 156);
  const cnf = Buffer.from(boot ? `BOOT2 = cdrom0:\\${serial};1\r\nVER = 1.00\r\n` : 'BOOT = cdrom0:\\PS1.EXE;1\r\n');
  cnf.copy(image, sector * 21);
  const elf = Buffer.alloc(64);
  elf.write('\x7fELF', 0, 'ascii'); elf[4] = 1; elf[5] = 1;
  elf.writeUInt16LE(machine, 18);
  elf.copy(image, sector * 22);
  Buffer.concat([
    record('\x00', 20, sector, true), record('\x01', 20, sector, true),
    record('SYSTEM.CNF;1', 21, cnf.length), record(`${serial};1`, 22, elf.length),
    record('DATA.CVM;1', 23, sector),
  ]).copy(image, sector * 20);
  return image;
}
