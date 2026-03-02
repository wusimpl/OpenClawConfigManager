// 托盘图标生成 —— 跨平台适配（macOS 模板图标 + Retina，Windows/Linux 蓝色图标）
const { nativeImage } = require('electron');

// PNG 编码工具函数
function buildPngHelpers() {
  const zlib = require('zlib');
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
  function encodePng(size, rawPixels) {
    const deflated = zlib.deflateSync(rawPixels);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', deflated),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
  }
  return { encodePng };
}

// 生成圆形图标的 RGBA 像素数据
function buildCirclePixels(size, r, g, b) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const center = (size - 1) / 2;
  const innerRadius = size * 7 / 16; // 内圆（完全不透明）
  const outerRadius = size * 8 / 16; // 外圆（抗锯齿边缘）
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // PNG filter: None
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      const dx = x - center, dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < innerRadius) {
        raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 0xFF;
      } else if (dist < outerRadius) {
        const a = Math.max(0, Math.min(255, Math.round((outerRadius - dist) / (outerRadius - innerRadius) * 255)));
        raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
      }
    }
  }
  return raw;
}

function createTrayIcon() {
  const { encodePng } = buildPngHelpers();

  if (process.platform === 'darwin') {
    // macOS：32x32 黑色模板图标（@2x Retina），系统自动适配暗色/亮色主题
    const size = 32;
    const raw = buildCirclePixels(size, 0x00, 0x00, 0x00);
    const png = encodePng(size, raw);
    const image = nativeImage.createFromBuffer(png, { scaleFactor: 2.0 });
    image.setTemplateImage(true);
    return image;
  }

  // Windows / Linux：16x16 蓝色图标
  const size = 16;
  const raw = buildCirclePixels(size, 0x21, 0x96, 0xF3);
  const png = encodePng(size, raw);
  return nativeImage.createFromBuffer(png);
}

module.exports = { createTrayIcon };
