/**
 * KML/KMZ — ورود علامت‌های نقشه
 *
 * فایل KML متنی ساده است و KMZ همان سند داخل آرشیو ZIP. این آزمون ساختار ZIP
 * را هم با روش «ذخیره» (STORED) و هم «فشرده» (DEFLATE) می‌سنجد تا هر دو
 * مسیر خواندن در kml.js پوشش داده شوند.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { extractKml, parseKml } from '../../kml.js';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>سوییچ اداری</name><description><![CDATA[طبقه ۳ &amp; اتاق سرور]]></description>
    <Point><coordinates>51.3896,35.7289,0</coordinates></Point></Placemark>
  <Placemark><name>مسیر فیبر</name>
    <LineString><coordinates>51.40,35.73,0 51.41,35.74,0</coordinates></LineString></Placemark>
  <Placemark><name>بدون مختصات</name></Placemark>
</Document></kml>`;

/** ساخت یک آرشیو ZIP کوچک با یک ورودی (کافی برای آزمون KMZ) */
function makeZip(name, content, { deflate = true } = {}) {
  const raw = Buffer.from(content, 'utf8');
  const data = deflate ? zlib.deflateRawSync(raw) : raw;
  const method = deflate ? 8 : 0;
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = zlib.crc32 ? zlib.crc32(raw) : 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc >>> 0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const localPart = Buffer.concat([local, nameBuf, data]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc >>> 0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const centralPart = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

test('Placemarkها به نقاط تبدیل می‌شوند؛ مسیر با نخستین مختصات و بی‌مختصات‌ها رد می‌شوند', () => {
  const { points, placemarks, skipped } = parseKml(KML);
  assert.equal(placemarks, 3);
  assert.equal(points.length, 2);
  assert.equal(skipped, 1);
  assert.deepEqual(points[0], { name: 'سوییچ اداری', notes: 'طبقه ۳ & اتاق سرور', latitude: 35.7289, longitude: 51.3896 });
  assert.equal(points[1].name, 'مسیر فیبر');
  assert.equal(points[1].latitude, 35.73);
});

test('KMZ فشرده و ذخیره‌نشده هر دو خوانده می‌شوند', () => {
  for (const deflate of [true, false]) {
    const kmz = makeZip('doc.kml', KML, { deflate });
    const text = extractKml(kmz, 'map.kmz');
    assert.match(text, /Placemark/);
    assert.equal(parseKml(text).points.length, 2);
  }
});

test('آرشیو بدون KML و پسوند نامعتبر با پیام مشخص رد می‌شوند', () => {
  assert.throws(() => extractKml(makeZip('readme.txt', 'hello'), 'x.kmz'), /KML/);
  assert.throws(() => extractKml(Buffer.from('<kml/>'), 'x.txt'), /\.kml/);
});
