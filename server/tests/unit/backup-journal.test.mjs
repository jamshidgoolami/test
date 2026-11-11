/**
 * آزمون Journal فایل‌های Restore:
 *   • خطای نصب → همهٔ فایل‌ها و دیتابیس به وضعیت قبلی برمی‌گردند.
 *   • SIGKILL پس از rename دیتابیس / فایل‌های میانی / کلید → در Startup بعدی
 *     Journal همهٔ فایل‌ها و Safety Copy را برمی‌گرداند.
 *   • مجموعهٔ بازگردانده‌شده از نظر دیتابیس، MBTiles و Attachment سازگار است.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, addDevice, cleanupDir, useTempDataDir } from '../helpers.mjs';

const dir = useTempDataDir('backup-journal');
const { db, MBTILES_DIR } = await import('../../db.js');
const { createBackup } = await import('../../backup.js');
const { ATTACHMENTS_DIR } = await import('../../attachments.js');
const { CREDENTIAL_KEY_FILE } = await import('../../credential-crypto.js');

const TILE_SHARED = 'shared-crash.mbtiles';
const TILE_ONLY = 'backup-only.mbtiles';
const ATTACH_SHARED = 'shared-crash.png';
const ATTACH_ONLY = 'backup-only.png';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const sourceDeviceId = addDevice(db, { name: 'backup-state', ip: '10.77.7.1', status: 'online' });
fs.mkdirSync(MBTILES_DIR, { recursive: true });
fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
fs.writeFileSync(path.join(MBTILES_DIR, TILE_SHARED), 'BACKUP-TILE-NEW');
fs.writeFileSync(path.join(MBTILES_DIR, TILE_ONLY), 'BACKUP-ONLY-TILE');
fs.writeFileSync(path.join(ATTACHMENTS_DIR, ATTACH_SHARED), PNG);
fs.writeFileSync(path.join(ATTACHMENTS_DIR, ATTACH_ONLY), Buffer.concat([PNG, Buffer.from('backup-only')]));
fs.writeFileSync(CREDENTIAL_KEY_FILE, 'BACKUP-KEY\n', { mode: 0o600 });
db.prepare(
  `INSERT INTO device_attachments(device_id, file_name, stored_name, mime, size_bytes, kind, uploaded_by, created_at)
   VALUES (?,?,?,?,?,?,?,?)`
).run(sourceDeviceId, ATTACH_SHARED, ATTACH_SHARED, 'image/png', PNG.length, 'image', 'test', Date.now());

const backup = createBackup({ reason: 'journal-tests' });
const preload = path.join(ROOT, 'server/tests/fixtures/crash-after-renames.mjs');
const rollbackPreload = path.join(ROOT, 'server/tests/fixtures/crash-during-rollback.mjs');

after(() => {
  db.close();
  cleanupDir(dir);
});

function makeTarget(tag) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), `netwatch-journal-${tag}-`));
  fs.mkdirSync(path.join(target, 'mbtiles'), { recursive: true });
  fs.mkdirSync(path.join(target, 'attachments'), { recursive: true });
  fs.copyFileSync(path.join(backup.dir, 'netwatch.db'), path.join(target, 'netwatch.db'));
  const conn = new DatabaseSync(path.join(target, 'netwatch.db'));
  try {
    conn.exec("DELETE FROM device_attachments");
    conn.exec("UPDATE devices SET name = 'target-old'");
  } finally {
    conn.close();
  }
  fs.writeFileSync(path.join(target, 'mbtiles', TILE_SHARED), 'TARGET-OLD-TILE');
  fs.writeFileSync(path.join(target, 'mbtiles', 'target-only.mbtiles'), 'TARGET-ONLY-TILE');
  fs.writeFileSync(path.join(target, 'attachments', ATTACH_SHARED), Buffer.concat([PNG, Buffer.from('target-old')]));
  fs.writeFileSync(path.join(target, 'attachments', 'target-only.png'), Buffer.concat([PNG, Buffer.from('target-only')]));
  fs.writeFileSync(path.join(target, 'device-credentials.key'), 'TARGET-OLD-KEY\n', { mode: 0o600 });
  return target;
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function assertTargetOld(target) {
  const conn = new DatabaseSync(path.join(target, 'netwatch.db'), { readOnly: true });
  try {
    assert.equal(conn.prepare('SELECT name FROM devices ORDER BY id LIMIT 1').get()?.name, 'target-old');
  } finally {
    conn.close();
  }
  assert.equal(readIfExists(path.join(target, 'mbtiles', TILE_SHARED)), 'TARGET-OLD-TILE');
  assert.equal(readIfExists(path.join(target, 'mbtiles', TILE_ONLY)), null);
  assert.equal(readIfExists(path.join(target, 'mbtiles', 'target-only.mbtiles')), 'TARGET-ONLY-TILE');
  assert.deepEqual(readIfExists(path.join(target, 'attachments', ATTACH_SHARED)), Buffer.concat([PNG, Buffer.from('target-old')]).toString('utf8'));
  assert.equal(readIfExists(path.join(target, 'attachments', ATTACH_ONLY)), null);
  assert.equal(readIfExists(path.join(target, 'attachments', 'target-only.png')), Buffer.concat([PNG, Buffer.from('target-only')]).toString('utf8'));
  assert.equal(readIfExists(path.join(target, 'device-credentials.key')), 'TARGET-OLD-KEY\n');
  assert.equal(
    fs.readdirSync(target).some((name) => name.startsWith('.restore-journal-')),
    false,
    'Journal باید پس از Rollback پاک شود'
  );
}

test('an injected install failure rolls back every changed file and the database', () => {
  const target = makeTarget('failure');
  try {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const fs = (await import('node:fs')).default;
         const path = await import('node:path');
         const { restoreBackup } = await import('./server/backup.js');
         const shared = path.join(process.env.NETWATCH_DATA_DIR, 'mbtiles', '${TILE_SHARED}');
         const original = fs.renameSync;
         let injected = false;
         fs.renameSync = function failOnce(from, to) {
           if (!injected && to === shared) { injected = true; throw new Error('injected install failure'); }
           return original.call(this, from, to);
         };
         try {
           restoreBackup(process.env.NETWATCH_BACKUP_SOURCE, { force: true });
           process.stdout.write('NO_ERROR\\n');
         } catch (e) {
           process.stdout.write('FAILED:' + e.message + '\\n');
         }`,
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          ...process.env,
          NETWATCH_DATA_DIR: target,
          NETWATCH_DB: path.join(target, 'netwatch.db'),
          NETWATCH_BACKUP_SOURCE: backup.dir,
          PORT: '3000',
          NETWATCH_ENGINE: '0',
          NETWATCH_LOG_STREAM: 'stderr',
        },
      }
    );
    assert.equal(child.status, 0, `failure test child crashed:\n${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /FAILED:injected install failure/, child.stderr);
    assertTargetOld(target);
  } finally {
    cleanupDir(target);
  }
});

function crashRestore(target, afterRenames) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      preload,
      '--input-type=module',
      '-e',
      "const { restoreBackup } = await import('./server/backup.js'); restoreBackup(process.env.NETWATCH_BACKUP_SOURCE, { force: true });",
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        NETWATCH_DATA_DIR: target,
        NETWATCH_BACKUP_SOURCE: backup.dir,
        PORT: '3000',
        NETWATCH_ENGINE: '0',
        NETWATCH_LOG_STREAM: 'stderr',
        NETWATCH_TEST_CRASH_AFTER_RENAMES: String(afterRenames),
      },
    }
  );
}

function recoverAndRead(target) {
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const fs = await import('node:fs');
       const path = await import('node:path');
       const { db } = await import('./server/db.js');
       const base = process.env.NETWATCH_DATA_DIR;
       const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
       const device = db.prepare('SELECT name FROM devices ORDER BY id LIMIT 1').get();
       const state = JSON.parse(fs.readFileSync(path.join(base, '.restore-state.json'), 'utf8'));
       process.stdout.write('RESULT:' + JSON.stringify({
         device: device?.name || null,
         state: state.status,
         requiresRecovery: state.requiresRecovery === true,
         sharedTile: read(path.join(base, 'mbtiles', '${TILE_SHARED}')),
         onlyTile: read(path.join(base, 'mbtiles', '${TILE_ONLY}')),
         sharedAttachment: read(path.join(base, 'attachments', '${ATTACH_SHARED}')),
         onlyAttachment: read(path.join(base, 'attachments', '${ATTACH_ONLY}')),
         key: read(path.join(base, 'device-credentials.key')),
       }) + '\\n');
       db.close();`,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        NETWATCH_DATA_DIR: target,
        NETWATCH_DB: path.join(target, 'netwatch.db'),
        PORT: '3000',
        NETWATCH_ENGINE: '0',
        NETWATCH_LOG_STREAM: 'stderr',
      },
    }
  );
  assert.equal(child.status, 0, `recovery failed:\n${child.stdout}\n${child.stderr}`);
  const line = child.stdout.split('\n').find((l) => l.startsWith('RESULT:'));
  assert.ok(line, `missing result:\n${child.stdout}\n${child.stderr}`);
  return JSON.parse(line.slice('RESULT:'.length));
}

test('a successful restore keeps database attachment references consistent with installed files', () => {
  const target = makeTarget('success');
  try {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const { restoreBackup } = await import('./server/backup.js'); restoreBackup(process.env.NETWATCH_BACKUP_SOURCE, { force: true });",
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          ...process.env,
          NETWATCH_DATA_DIR: target,
          NETWATCH_BACKUP_SOURCE: backup.dir,
          PORT: '3000',
          NETWATCH_ENGINE: '0',
          NETWATCH_LOG_STREAM: 'stderr',
        },
      }
    );
    assert.equal(child.status, 0, `restore failed:\n${child.stdout}\n${child.stderr}`);
    const conn = new DatabaseSync(path.join(target, 'netwatch.db'), { readOnly: true });
    try {
      assert.equal(conn.prepare('SELECT name FROM devices ORDER BY id LIMIT 1').get()?.name, 'backup-state');
      const row = conn.prepare('SELECT stored_name FROM device_attachments').get();
      assert.equal(row?.stored_name, ATTACH_SHARED);
      assert.ok(fs.existsSync(path.join(target, 'attachments', row.stored_name)));
    } finally {
      conn.close();
    }
    assert.equal(fs.readFileSync(path.join(target, 'attachments', ATTACH_SHARED)).toString('hex'), PNG.toString('hex'));
    assert.equal(fs.readFileSync(path.join(target, 'mbtiles', TILE_SHARED), 'utf8'), 'BACKUP-TILE-NEW');
    assert.ok(fs.existsSync(path.join(target, 'mbtiles', TILE_ONLY)));
    assert.ok(fs.existsSync(path.join(target, 'attachments', ATTACH_ONLY)));
    assert.equal(fs.readFileSync(path.join(target, 'device-credentials.key'), 'utf8'), 'BACKUP-KEY\n');
  } finally {
    cleanupDir(target);
  }
});

test('SIGKILL during rollback is completed by Journal recovery on next startup', () => {
  const target = makeTarget('rollback-crash');
  try {
    const crash = spawnSync(
      process.execPath,
      [
        '--import',
        rollbackPreload,
        '--input-type=module',
        '-e',
        "const { restoreBackup } = await import('./server/backup.js'); restoreBackup(process.env.NETWATCH_BACKUP_SOURCE, { force: true });",
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          ...process.env,
          NETWATCH_DATA_DIR: target,
          NETWATCH_BACKUP_SOURCE: backup.dir,
          PORT: '3000',
          NETWATCH_ENGINE: '0',
          NETWATCH_LOG_STREAM: 'stderr',
          NETWATCH_TEST_FAIL_INSTALL_AT: '3',
          NETWATCH_TEST_CRASH_ROLLBACK_AFTER: '1',
        },
      }
    );
    assert.equal(crash.signal, 'SIGKILL', `rollback did not crash:\n${crash.stdout}\n${crash.stderr}`);
    const result = recoverAndRead(target);
    assert.equal(result.state, 'recovered_interrupted');
    assert.equal(result.requiresRecovery, false);
    assert.equal(result.device, 'target-old');
    assert.equal(result.sharedTile, 'TARGET-OLD-TILE');
    assert.equal(result.onlyTile, null);
    assert.equal(result.sharedAttachment, Buffer.concat([PNG, Buffer.from('target-old')]).toString('utf8'));
    assert.equal(result.onlyAttachment, null);
    assert.equal(result.key, 'TARGET-OLD-KEY\n');
    assertTargetOld(target);
  } finally {
    cleanupDir(target);
  }
});

for (const afterRenames of [1, 2, 4, 6]) {
  test(`SIGKILL after ${afterRenames} rename(s) recovers database and files`, () => {
    const target = makeTarget(`crash-${afterRenames}`);
    try {
      const crash = crashRestore(target, afterRenames);
      assert.equal(crash.signal, 'SIGKILL', `restore did not crash:\n${crash.stdout}\n${crash.stderr}`);
      const result = recoverAndRead(target);
      assert.equal(result.state, 'recovered_interrupted');
      assert.equal(result.requiresRecovery, false);
      assert.equal(result.device, 'target-old');
      assert.equal(result.sharedTile, 'TARGET-OLD-TILE');
      assert.equal(result.onlyTile, null);
      assert.equal(result.sharedAttachment, Buffer.concat([PNG, Buffer.from('target-old')]).toString('utf8'));
      assert.equal(result.onlyAttachment, null);
      assert.equal(result.key, 'TARGET-OLD-KEY\n');
      assertTargetOld(target);
    } finally {
      cleanupDir(target);
    }
  });
}
