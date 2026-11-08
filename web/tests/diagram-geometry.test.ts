import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLink, connectionPath } from '../src/lib/diagram-geometry.ts';
import type { LinkRect } from '../src/lib/diagram-geometry.ts';

function rect(x: number, y: number, width = 190, height = 86): LinkRect {
  return { x, y, width, height };
}

test('two devices in the same row connect from side centre to side centre', () => {
  const a = rect(0, 100);
  const b = rect(400, 100);
  const link = computeLink(a, b);

  assert.equal(link.axis, 'x');
  assert.deepEqual(link.start, { x: 190, y: 143 }, 'مرکز ضلع راست تجهیز اول');
  assert.deepEqual(link.end, { x: 400, y: 143 }, 'مرکز ضلع چپ تجهیز دوم');
  assert.equal(link.start.y, link.end.y, 'هم‌راستا → خط افقی');
  assert.match(link.path, /^M 190 143 L 400 143$/, 'برای هم‌راستا خط صاف و کوتاه است');
});

test('two stacked devices connect from bottom centre to top centre', () => {
  const a = rect(50, 0);
  const b = rect(50, 300);
  const link = computeLink(a, b);

  assert.equal(link.axis, 'y');
  assert.deepEqual(link.start, { x: 145, y: 86 });
  assert.deepEqual(link.end, { x: 145, y: 300 });
  assert.match(link.path, /^M 145 86 L 145 300$/);
});

test('diagonal neighbours get a gentle curve anchored at the facing side centres', () => {
  const a = rect(0, 0);
  const b = rect(300, 240);
  const link = computeLink(a, b);

  assert.equal(link.axis, 'x', 'اختلاف افقی بیشتر است');
  assert.deepEqual(link.start, { x: 190, y: 43 }, 'مرکز ضلع راست تجهیز اول');
  assert.deepEqual(link.end, { x: 300, y: 283 }, 'مرکز ضلع چپ تجهیز دوم');
  assert.match(link.path, /^M 190 43 C /, 'در حالت مورب مسیر خم ملایم دارد');
  assert.ok(link.path.endsWith('300 283'), link.path);
  // هیچ‌کدام از نقاط از کادرها بیرون نمی‌زند.
  assert.ok(link.start.x >= a.x && link.start.x <= a.x + a.width);
  assert.ok(link.end.x >= b.x && link.end.x <= b.x + b.width);
});

test('the curve stays between the two facing edges (no overshoot)', () => {
  const a = rect(0, 0);
  const b = rect(240, 400);
  const link = computeLink(a, b);
  // در این چیدمان اختلاف عمودی بیشتر است، پس خط عمودی و بین دو لبه حرکت می‌کند.
  assert.equal(link.axis, 'y');
  const numbers = [...link.path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  const ys = numbers.filter((_, index) => index % 2 === 1);
  assert.ok(Math.min(...ys) >= link.start.y - 0.1, 'خط از لبهٔ پایین تجهیز اول عقب‌تر نمی‌رود');
  assert.ok(Math.max(...ys) <= link.end.y + 0.1, 'خط از لبهٔ بالای تجهیز دوم جلوتر نمی‌رود');
});

test('a target on the left is joined from the left edge of the source', () => {
  const a = rect(500, 100);
  const b = rect(0, 100);
  const link = computeLink(a, b);

  assert.deepEqual(link.start, { x: 500, y: 143 }, 'ضلع چپ تجهیز سمت راست');
  assert.deepEqual(link.end, { x: 190, y: 143 }, 'ضلع راست تجهیز سمت چپ');
  assert.match(link.path, /^M 500 143 L 190 143$/);
});

test('overlapping devices still produce a finite path', () => {
  const link = computeLink(rect(0, 0), rect(10, 10));

  assert.doesNotMatch(link.path, /NaN/);
  assert.match(link.path, /^M -?[\d.]+ -?[\d.]+ L -?[\d.]+ -?[\d.]+$/);
});

test('connectionPath mirrors the computed geometry', () => {
  const a = rect(0, 0);
  const b = rect(420, 120);

  assert.equal(connectionPath(a, b), computeLink(a, b).path);
});
