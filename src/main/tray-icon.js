// 托盘图标生成 —— 构建 16x16 蓝色圆形 PNG
const { nativeImage } = require('electron');

function createTrayIcon() {
  const zlib = require('zlib');
  const size = 16;
  // 构建 16x16 RGBA 像素数据（蓝色圆形）
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // PNG filter: None
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      const dx = x - 7.5, dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 7) {
        raw[i] = 0x21; raw[i + 1] = 0x96; raw[i + 2] = 0xF3; raw[i + 3] = 0xFF;
      } else if (dist < 8) {
        const a = Math.max(0, Math.min(255, Math.round((8 - dist) * 255)));
        raw[i] = 0x21; raw[i + 1] = 0x96; raw[i + 2] = 0xF3; raw[i + 3] = a;
      }
    }
  }
  const deflated = zlib.deflateSync(raw);
  // CRC32
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c;
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function pngChunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, c]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflated),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

module.exports = { createTrayIcon };
