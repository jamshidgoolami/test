/**
 * آزمون امنیتی Backup: نام‌های مانیفست نباید از پوشهٔ پشتیبان خارج شوند.
 *
 * فرمت Backup یک پوشهٔ ساده است و آرشیو/ZIP در آن استخراج نمی‌شود؛ بنابراین
 * سطح حملهٔ ZIP Bomb وجود ندارد. اما مانیفست می‌تواند نام‌های مسیردار داشته
 * باشد؛ verify/restore باید آن‌ها را با basename محدود کنند.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { useTempDataDir, cleanupDir, addDevice } from '../helpers.mjs';

const dir = useTempDataDir('backup-security');
const { db } = await import('../../db.js');
const { createBackup, verifyBackup, restoreBackup } = await import('../../backup.js');

addDevice(db, { name: 'security-device', ip: '10.77.8.1', status: 'online' });

after(() => cleanupDir(dir));

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('manifest names cannot read files outside the backup directory', () => {
  const backup = createBackup({ reason: 'traversal-test' });
  const outside = path.join(dir, 'outside.bin');
  fs.writeFileSync(outside, 'attacker-controlled');
  const digest = sha256(outside);

  const manifestPath = path.join(backup.dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.mbtiles = [{ name: '../../outside.bin', size: fs.statSync(outside).size, sha256: digest }];
  manifest.attachments = [{ name: '../../../outside.bin', size: fs.statSync(outside).size, sha256: digest }];
  manifest.credentialsKey = { source: 'file', file: '../../outside.bin', sha256: digest };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const report = verifyBackup(backup.dir);
  assert.equal(report.ok, false);
  assert.equal(report.mbtiles.length, 0, 'هیچ فایل نقشهٔ بیرون از پوشه نباید پذیرفته شود');
  assert.equal(report.attachments.length, 0, 'هیچ پیوست بیرون از پوشه نباید پذیرفته شود');
  assert.equal(report.credentialsKey.file, null, 'کلید بیرون از پوشه نباید پذیرفته شود');
  assert.ok(report.errors.some((e) => e.includes('غایب است')));

  assert.throws(() => restoreBackup(backup.dir, { force: true }), (e) => e.code === 'DB_BACKUP_INVALID');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'attacker-controlled');
});
