/**
 * NetWatch — خواندن فایل‌های KML/KMZ برای «علامت‌های نقشه»
 * ----------------------------------------------------------------
 * فایل KML یک سند XML است و KMZ همان KML فشرده‌شده در یک آرشیو ZIP.
 * این ماژول بدون وابستگی بیرونی کار می‌کند: XML با یک اسکن سادهٔ تگ‌ها
 * خوانده می‌شود و برای KMZ، ساختار ZIP (Central Directory) مستقیماً
 * خوانده و ورودی موردنظر با `zlib.inflateRawSync` باز می‌شود.
 *
 * فقط از هر Placemark یک نقطه برداشته می‌شود؛ اگر Placemark نقطه نداشته
 * باشد (مسیر/چندضلعی)، نخستین مختصات آن به‌عنوان نمایندهٔ آن استفاده می‌شود
 * تا دادهٔ نقشه در ورود از دست نرود.
 */
import zlib from 'node:zlib';

const MAX_PLACEMARKS = 20000;
const MAX_UNCOMPRESSED = 256 * 1024 * 1024;
const MAX_ENTRIES = 2000;

/** موجودیت‌های XML و CDATA را به متن قابل نمایش تبدیل می‌کند. */
export function decodeXml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** محتوای نخستین تگ مشخص‌شده در یک قطعهٔ XML. */
function tagText(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? decodeXml(m[1]) : '';
}

/** تبدیل متن <coordinates> به { lat, lng } (نخستین نقطهٔ معتبر). */
function firstCoordinate(coordinates) {
  const first = decodeXml(coordinates).split(/\s+/).find(Boolean);
  if (!first) return null;
  const [lng, lat] = first.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * سند KML را به فهرست نقطه‌ها تبدیل می‌کند.
 * @returns {{ points: {name:string, notes:string, latitude:number, longitude:number}[], placemarks:number, skipped:number }}
 */
export function parseKml(text) {
  const kml = String(text ?? '');
  const blocks = kml.match(/<Placemark(?:\s[^>]*)?>[\s\S]*?<\/Placemark>/gi) || [];
  const points = [];
  let skipped = 0;
  for (const block of blocks.slice(0, MAX_PLACEMARKS)) {
    // نخست نقطهٔ هندسه؛ در نبود نقطه، نخستین مختصات مسیر/چندضلعی.
    const pointBlock = block.match(/<Point(?:\s[^>]*)?>([\s\S]*?)<\/Point>/i);
    const coordinates = pointBlock ? tagText(pointBlock[1], 'coordinates') : tagText(block, 'coordinates');
    const coord = firstCoordinate(coordinates);
    if (!coord) {
      skipped += 1;
      continue;
    }
    const name = tagText(block, 'name') || `علامت KML ${points.length + 1}`;
    const description = tagText(block, 'description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    points.push({
      name: name.slice(0, 120),
      notes: description.slice(0, 500),
      latitude: Number(coord.lat.toFixed(6)),
      longitude: Number(coord.lng.toFixed(6)),
    });
  }
  return { points, placemarks: blocks.length, skipped };
}

/* ------------------------------- KMZ / ZIP ------------------------------- */

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;

/** نام و محل دادهٔ ورودی‌های آرشیو را از Central Directory می‌خواند. */
function zipEntries(buffer) {
  // امضای EOCD از انتها جست‌وجو می‌شود (حداکثر ۶۴ کیلوبایت کامنت).
  const min = Math.max(0, buffer.length - 66 * 1024);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === ZIP_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('آرشیو KMZ معتبر نیست (پایان فهرست ZIP یافت نشد).');
  const count = Math.min(buffer.readUInt16LE(eocd + 10), MAX_ENTRIES);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** دادهٔ یک ورودی ZIP را باز می‌کند (STORED یا DEFLATE). */
function readEntry(buffer, entry) {
  if (entry.uncompressedSize > MAX_UNCOMPRESSED) throw new Error('فایل KMZ بیش از حد بزرگ است.');
  const local = entry.localOffset;
  if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) {
    throw new Error('ساختار آرشیو KMZ خراب است.');
  }
  const nameLen = buffer.readUInt16LE(local + 26);
  const extraLen = buffer.readUInt16LE(local + 28);
  const start = local + 30 + nameLen + extraLen;
  const raw = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    const out = zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNCOMPRESSED });
    // سقف اعلام‌شده ممکن است دروغ باشد؛ اندازهٔ واقعی هم کنترل می‌شود.
    if (out.length > MAX_UNCOMPRESSED) throw new Error('فایل KMZ بیش از حد بزرگ است.');
    return out;
  }
  throw new Error('روش فشرده‌سازی داخل KMZ پشتیبانی نمی‌شود.');
}

/**
 * متن KML را از فایل KMZ بیرون می‌کشد. اولویت با `doc.kml` است و در نبود آن،
 * نخستین فایل `.kml` آرشیو خوانده می‌شود.
 */
export function readKmz(buffer) {
  const entries = zipEntries(buffer);
  const kmlEntries = entries.filter((e) => /\.kml$/i.test(e.name));
  if (!kmlEntries.length) throw new Error('در آرشیو KMZ هیچ فایل KML یافت نشد.');
  const main = kmlEntries.find((e) => /(^|\/)doc\.kml$/i.test(e.name)) || kmlEntries[0];
  return readEntry(buffer, main).toString('utf8');
}

/**
 * بر اساس امضای فایل (نه فقط پسوند) KML متنی را برمی‌گرداند؛
 * امضای `PK` یعنی آرشیو KMZ.
 */
export function extractKml(buffer, filename = '') {
  if (!buffer || !buffer.length) throw new Error('فایل خالی است.');
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip || /\.kmz$/i.test(filename)) {
    return readKmz(buffer);
  }
  if (!/\.kml$/i.test(filename)) {
    throw new Error('فقط فایل با پسوند .kml یا .kmz پذیرفته می‌شود.');
  }
  // KML استاندارد UTF-8 است؛ BOM حذف می‌شود.
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}
