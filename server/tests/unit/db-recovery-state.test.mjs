/**
 * Recovery قبل از بازکردن SQLite:
 *   • فایل وضعیت خراب نباید بی‌صدا نادیده گرفته شود.
 *   • وضعیت بازیابی باید پیش از پاک‌سازی Journal durable شود.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverInterruptedRestoreBeforeOpen } from '../../db-recovery.js';

const dirs = [];
function tempDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `netwatch-recovery-${tag}-`));
  dirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeInterrupted(base, tag) {
  const dbFile = path.join(base, 'netwatch.db');
  const mbtilesDir = path.join(base, 'mbtiles');
  const journalDir = path.join(base, `.restore-journal-1-${tag}`);
  const target = path.join(base, 'artifact.bin');
  const previous = path.join(journalDir, 'previous.bin');
  fs.mkdirSync(journalDir, { recursive: true });
  fs.writeFileSync(dbFile, 'database');
  fs.writeFileSync(target, 'current');
  fs.writeFileSync(previous, 'previous');
  fs.writeFileSync(
    path.join(base, '.restore-state.json'),
    JSON.stringify({
      status: 'in_progress',
      requiresRecovery: true,
      phase: 'installing_files',
      safetyFile: null,
      journalDir,
      dbInstallStarted: false,
      fileOperations: [
        {
          type: 'file',
          name: 'artifact.bin',
          target,
          backup: previous,
          existed: true,
          tmp: `${target}.restore-tmp-test`,
        },
      ],
    })
  );
  return { dbFile, mbtilesDir, journalDir, target, stateFile: path.join(base, '.restore-state.json') };
}

test('a corrupt restore state stops recovery instead of ignoring possible partial state', () => {
  const base = tempDir('corrupt');
  const stateFile = path.join(base, '.restore-state.json');
  fs.writeFileSync(stateFile, '{not-json');

  assert.throws(
    () => recoverInterruptedRestoreBeforeOpen({ dataDir: base, dbPath: path.join(base, 'netwatch.db'), mbtilesDir: path.join(base, 'mbtiles') }),
    (error) => error.code === 'RESTORE_STATE_CORRUPT'
  );
  assert.equal(fs.readFileSync(stateFile, 'utf8'), '{not-json', 'corrupt state must be preserved for diagnosis');
});

test('journal is not removed when writing the recovered state fails', () => {
  const base = tempDir('write-failure');
  const fixture = makeInterrupted(base, 'write-failure');
  const originalRename = fs.renameSync;
  fs.renameSync = function failStateRename(from, to) {
    if (to === fixture.stateFile) {
      throw Object.assign(new Error('simulated state write failure'), { code: 'EIO' });
    }
    return originalRename.call(this, from, to);
  };
  try {
    const result = recoverInterruptedRestoreBeforeOpen({
      dataDir: base,
      dbPath: fixture.dbFile,
      mbtilesDir: fixture.mbtilesDir,
    });
    assert.equal(result.status, 'recovered_interrupted');
    assert.equal(fs.readFileSync(fixture.target, 'utf8'), 'previous');
    assert.ok(fs.existsSync(fixture.journalDir), 'journal must survive a failed state write');
    assert.equal(JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')).status, 'in_progress');
  } finally {
    fs.renameSync = originalRename;
  }
});

test('a successful recovery writes the final state before removing the journal', () => {
  const base = tempDir('success');
  const fixture = makeInterrupted(base, 'success');
  const result = recoverInterruptedRestoreBeforeOpen({
    dataDir: base,
    dbPath: fixture.dbFile,
    mbtilesDir: fixture.mbtilesDir,
  });

  assert.equal(result.status, 'recovered_interrupted');
  assert.equal(fs.readFileSync(fixture.target, 'utf8'), 'previous');
  assert.equal(JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')).status, 'recovered_interrupted');
  assert.equal(fs.existsSync(fixture.journalDir), false);
});
