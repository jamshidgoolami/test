/**
 * زمان‌بند Backup:
 *   • اجرای موفق lastBackupAt را ثبت می‌کند.
 *   • اجرای ناموفق نباید lastBackupAt را جلو ببرد و باید Retry زمان‌بندی کند.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const schedulerUrl = new URL('../../backup-scheduler.js', import.meta.url).href;

function runScheduler(dataDir, backupDir) {
  const script = `
    const { startBackupScheduler, stopBackupScheduler, backupStatus } =
      await import(${JSON.stringify(schedulerUrl)});
    startBackupScheduler();
    await new Promise((resolve) => setTimeout(resolve, 7000));
    const status = backupStatus();
    console.log('RESULT:' + JSON.stringify({ lastBackupAt: status.lastBackupAt, count: status.count }));
    stopBackupScheduler();
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        NETWATCH_DATA_DIR: dataDir,
        NETWATCH_BACKUP_DIR: backupDir,
        NETWATCH_SEED_DEMO: '0',
        NETWATCH_ENGINE: '0',
        NETWATCH_LOG_STREAM: 'stderr',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`scheduler child failed (${code}):\n${stdout}\n${stderr}`));
      const line = stdout.split('\n').find((item) => item.startsWith('RESULT:'));
      if (!line) return reject(new Error(`missing scheduler result:\n${stdout}\n${stderr}`));
      resolve({ ...JSON.parse(line.slice('RESULT:'.length)), stderr });
    });
  });
}

function tempDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `netwatch-scheduler-${tag}-`));
}

test('a successful scheduled backup advances lastBackupAt', async () => {
  const dir = tempDir('ok');
  try {
    const result = await runScheduler(dir, path.join(dir, 'backups'));
    assert.ok(result.count >= 1, 'a backup set must be created');
    assert.ok(result.lastBackupAt > 0, 'lastBackupAt must be recorded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed scheduled backup keeps lastBackupAt and schedules a retry', async () => {
  const dir = tempDir('fail');
  const blocker = path.join(dir, 'blocked');
  try {
    fs.writeFileSync(blocker, 'this is a file, not a directory');
    const result = await runScheduler(dir, path.join(blocker, 'backups'));
    assert.equal(result.lastBackupAt, null, 'a failed backup must not advance lastBackupAt');
    assert.equal(result.count, 0);
    assert.match(result.stderr, /backup_scheduler_retry/, `retry was not scheduled:\n${result.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
