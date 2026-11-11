/**
 * آزمون بازرسی پشتیبان: فایل سالم باید ok باشد و شمارش‌ها با محتوای
 * پایگاه‌داده بخوانند؛ فایل ناقص باید جدول‌های غایب را گزارش کند.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectSqliteFile, tableCounts } from '../../backup-integrity.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netwatch-integrity-'));
const file = path.join(dir, 'backup.db');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const conn = new DatabaseSync(file);
conn.exec(`
  CREATE TABLE settings (id INTEGER PRIMARY KEY);
  CREATE TABLE devices (id INTEGER PRIMARY KEY);
  CREATE TABLE samples (id INTEGER PRIMARY KEY);
  CREATE TABLE outages (id INTEGER PRIMARY KEY, open INTEGER);
  CREATE TABLE daily_stats (id INTEGER PRIMARY KEY);
  CREATE TABLE alerts (id INTEGER PRIMARY KEY);
  INSERT INTO devices (id) VALUES (1), (2);
  INSERT INTO outages (id, open) VALUES (1, 0), (2, 1);
`);
conn.close();

test('a complete backup passes inspection and counts rows', () => {
  const info = inspectSqliteFile(file);
  assert.equal(info.ok, true, info.errors.join('; '));
  const counts = tableCounts(file);
  assert.equal(counts.devices, 2);
  assert.equal(counts.openOutages, 1);
  assert.equal(counts.samples, 0);
  assert.equal(counts.alerts, 0);
});

test('inspection reports required tables that are missing', () => {
  const broken = path.join(dir, 'broken.db');
  const db = new DatabaseSync(broken);
  db.exec('CREATE TABLE devices (id INTEGER PRIMARY KEY);');
  db.close();
  const info = inspectSqliteFile(broken);
  assert.equal(info.ok, false);
  assert.ok(info.errors.some((message) => message.includes('جدول‌های غایب')));
});

test('missing file is reported instead of thrown', () => {
  const info = inspectSqliteFile(path.join(dir, 'does-not-exist.db'));
  assert.equal(info.ok, false);
  assert.ok(info.errors.length > 0);
});
