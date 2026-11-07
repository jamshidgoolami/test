import test from 'node:test';
import assert from 'node:assert/strict';
import { shortestLink, shortestLinkPath } from '../src/lib/diagram-geometry.ts';
import type { LinkRect } from '../src/lib/diagram-geometry.ts';

function rect(x: number, y: number, width = 190, height = 86): LinkRect {
  return { x, y, width, height };
}

test('two devices in the same row are joined by a straight horizontal line', () => {
  const a = rect(0, 100);
  const b = rect(400, 100);

  const { start, end } = shortestLink(a, b);

  assert.equal(start.y, end.y, 'خط بین دو تجهیز هم‌راستا افقی می‌ماند');
  assert.equal(start.x, 190, 'از لبهٔ نزدیک تجهیز اول شروع می‌شود');
  assert.equal(end.x, 400, 'روی لبهٔ نزدیک تجهیز دوم تمام می‌شود');
  assert.equal(end.x - start.x, 210, 'طول خط فقط فاصلهٔ بین دو تجهیز است');
  assert.ok(start.y > a.y && start.y < a.y + a.height, 'خط از بالای تجهیز رد نمی‌شود');
});

test('two stacked devices are joined vertically instead of looping around', () => {
  const a = rect(50, 0);
  const b = rect(50, 300);

  const { start, end } = shortestLink(a, b);

  assert.equal(start.x, end.x, 'خط عمودی است');
  assert.equal(start.y, 86);
  assert.equal(end.y, 300);
  assert.equal(end.y - start.y, 214);
});

test('diagonal neighbours get the shortest segment between their nearest corners', () => {
  const a = rect(0, 0);
  const b = rect(300, 240);

  const { start, end } = shortestLink(a, b);

  // در حالت مورب، خط دقیقاً از نزدیک‌ترین گوشه‌ها می‌گذرد.
  assert.deepEqual(start, { x: 190, y: 86 }, 'شروع روی گوشهٔ پایین-راست تجهیز اول');
  assert.deepEqual(end, { x: 300, y: 240 }, 'پایان روی گوشهٔ بالا-چپ تجهیز دوم');
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  assert.equal(length, Math.hypot(110, 154), 'طول خط همان فاصلهٔ گوشه‌به‌گوشه است');
});

test('overlapping devices still produce a finite path', () => {
  const path = shortestLinkPath(rect(0, 0), rect(10, 10));

  assert.match(path, /^M \d+ \d+ L \d+ \d+$/);
  assert.ok(!path.includes('NaN'));
});

test('the svg path mirrors the computed endpoints', () => {
  const a = rect(0, 0);
  const b = rect(400, 0);
  const { start, end } = shortestLink(a, b);

  assert.equal(shortestLinkPath(a, b), `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
});
