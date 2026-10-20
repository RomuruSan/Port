// Small original test programs: return the input argument plus one. No game data.
export function makeElf({ ppc = false } = {}) {
  const data = Buffer.alloc(0x110);
  data.write('\x7fELF', 0, 'ascii'); data[4] = ppc ? 2 : 1; data[5] = ppc ? 2 : 1; data[6] = 1;
  if (ppc) {
    data.writeUInt16BE(2, 16); data.writeUInt16BE(21, 18); data.writeUInt32BE(1, 20);
    data.writeBigUInt64BE(0x100000n, 24); data.writeBigUInt64BE(64n, 32);
    data.writeUInt32BE(2, 48); data.writeUInt16BE(64, 52); data.writeUInt16BE(56, 54); data.writeUInt16BE(1, 56);
    data.writeUInt32BE(1, 64); data.writeUInt32BE(5, 68); data.writeBigUInt64BE(0x100n, 72);
    data.writeBigUInt64BE(0x100000n, 80); data.writeBigUInt64BE(0x100000n, 88);
    data.writeBigUInt64BE(12n, 96); data.writeBigUInt64BE(12n, 104); data.writeBigUInt64BE(16n, 112);
    [0x38630001, 0x4e800020, 0x60000000].forEach((word, i) => data.writeUInt32BE(word, 0x100 + i * 4));
  } else {
    data.writeUInt16LE(2, 16); data.writeUInt16LE(8, 18); data.writeUInt32LE(1, 20);
    data.writeUInt32LE(0x100000, 24); data.writeUInt32LE(52, 28); data.writeUInt32LE(0x10000000, 36);
    data.writeUInt16LE(52, 40); data.writeUInt16LE(32, 42); data.writeUInt16LE(1, 44);
    data.writeUInt32LE(1, 52); data.writeUInt32LE(0x100, 56); data.writeUInt32LE(0x100000, 60); data.writeUInt32LE(0x100000, 64);
    data.writeUInt32LE(12, 68); data.writeUInt32LE(12, 72); data.writeUInt32LE(5, 76); data.writeUInt32LE(16, 80);
    [0x24820001, 0x03e00008, 0].forEach((word, i) => data.writeUInt32LE(word, 0x100 + i * 4));
  }
  return data;
}
