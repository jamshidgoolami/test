/**
 * بازیابی کامل روی DATA_DIR خالی:
 *   • پایگاه‌داده، MBTiles، پیوست‌ها و کلید رمزنگاری با هم برمی‌گردند
 *   • checksum همهٔ اجزا پیش از بازیابی بررسی می‌شود
 *   • یک مجموعهٔ ناقص (پیوست حذف‌شده) پیش از هر تغییری رد می‌شود
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, addDevice, cleanupDir, useTempDataDir } from '../helpers.mjs';

const sourceDir = useTempDataDir('backup-complete-source');
const { db, MBTILES_DIR, SCHEMA_VERSION, seedIfEmpty } = await import('../../db.js');
const { createBackup, verifyBackup } = await import('../../backup.js');
const { ALLOWED_TYPES, writeAttachmentFile } = await import('../../attachments.js');
const { CREDENTIAL_KEY_FILE } = await import('../../credential-crypto.js');

seedIfEmpty();
const deviceId = addDevice(db, { name: 'restored-into-empty-dir', ip: '10.88.0.7', status: 'online' });

const keyValue = `${crypto.randomBytes(32).toString('base64')}\n`;
fs.writeFileSync(CREDENTIAL_KEY_FILE, keyValue, { mode: 0o600 });
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const attachment = writeAttachmentFile(png, ALLOWED_TYPES.png);
const tileName = 'restore-empty.mbtiles';
fs.writeFileSync(
  path.join(MBTILES_DIR, tileName),
  Buffer.concat([Buffer.from('SQLite format 3\0'), crypto.randomBytes(512)])
);

const backup = createBackup({ reason: 'empty-restore-test' });
const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netwatch-empty-target-'));

after(() => {
  db.close();
  cleanupDir(sourceDir);
  cleanupDir(targetDir);
});

test('a complete backup restores database, MBTiles, attachments and key into an empty DATA_DIR', () => {
  const verification = verifyBackup(backup.dir);
  assert.equal(verification.ok, true, verification.errors.join(' | '));
  assert.equal(verification.attachments.length, 1);
  assert.equal(verification.credentialsKey.source, 'file');

  const result = spawnSync(process.execPath, ['server/scripts/db-restore.mjs', backup.dir, '--force'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      NETWATCH_DATA_DIR: targetDir,
      PORT: '3000',
      NETWATCH_ENGINE: '0',
      NETWATCH_LOG_STREAM: 'stderr',
    },
  });
  assert.equal(result.status, 0, `restore failed:\n${result.stdout}\n${result.stderr}`);

  const targetDb = path.join(targetDir, 'netwatch.db');
  assert.ok(fs.existsSync(targetDb), 'database must exist after restore');
  const conn = new DatabaseSync(targetDb, { readOnly: true });
  try {
    const row = conn.prepare('SELECT name FROM devices WHERE id = ?').get(deviceId);
    assert.equal(row?.name, 'restored-into-empty-dir');
    assert.equal(Number(conn.prepare('PRAGMA user_version').get().user_version), SCHEMA_VERSION);
  } finally {
    conn.close();
  }

  assert.ok(fs.existsSync(path.join(targetDir, 'attachments', attachment.storedName)), 'attachment restored');
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(path.join(targetDir, 'attachments', attachment.storedName))).digest('hex'),
    backup.manifest.attachments[0].sha256
  );
  assert.equal(fs.readFileSync(path.join(targetDir, 'device-credentials.key'), 'utf8'), keyValue);
  assert.ok(fs.existsSync(path.join(targetDir, 'mbtiles', tileName)), 'MBTiles restored');
});

test('an incomplete backup is rejected before touching an empty target', () => {
  const incomplete = createBackup({ reason: 'incomplete-empty-target' });
  fs.unlinkSync(path.join(incomplete.dir, 'attachments', attachment.storedName));
  const freshTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'netwatch-empty-reject-'));
  try {
    assert.equal(verifyBackup(incomplete.dir).ok, false);
    const result = spawnSync(process.execPath, ['server/scripts/db-restore.mjs', incomplete.dir, '--force'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        NETWATCH_DATA_DIR: freshTarget,
        PORT: '3000',
        NETWATCH_ENGINE: '0',
        NETWATCH_LOG_STREAM: 'stderr',
      },
    });
    assert.notEqual(result.status, 0, 'incomplete restore must fail');
    assert.ok(!fs.existsSync(path.join(freshTarget, 'attachments', attachment.storedName)));
    // فقط پایگاه‌دادهٔ خالی که خود db.js ساخته است وجود دارد؛ دادهٔ پشتیبان نصب نشده است.
    assert.ok(!fs.existsSync(path.join(freshTarget, 'device-credentials.key')));
  } finally {
    cleanupDir(freshTarget);
  }
});
