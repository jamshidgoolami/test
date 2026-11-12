/**
 * خطای fsync واقعی (EIO/ENOSPC/EBADF) نباید مثل «فایل‌سیستم پشتیبانی نمی‌کند»
 * نادیده گرفته شود؛ فقط EINVAL/ENOTSUP/EOPNOTSUPP/ENOSYS قابل اغماض‌اند.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stagePreviousFile } from '../../backup-journal.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netwatch-journal-fsync-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function fixture(tag) {
  const target = path.join(dir, `${tag}.bin`);
  const journalDir = path.join(dir, `journal-${tag}`);
  fs.writeFileSync(target, 'current');
  fs.mkdirSync(journalDir, { recursive: true });
  return { target, journalDir };
}

test('a real fsync I/O error propagates', () => {
  const { target, journalDir } = fixture('eio');
  const originalFsync = fs.fsyncSync;
  fs.fsyncSync = () => {
    throw Object.assign(new Error('simulated fsync EIO'), { code: 'EIO' });
  };
  try {
    assert.throws(
      () => stagePreviousFile({ journalDir, index: 0, type: 'file', target }),
      /simulated fsync EIO/
    );
  } finally {
    fs.fsyncSync = originalFsync;
  }
});

test('an unsupported fsync error is ignored and the backup is staged', () => {
  const { target, journalDir } = fixture('unsupported');
  const originalFsync = fs.fsyncSync;
  fs.fsyncSync = () => {
    throw Object.assign(new Error('simulated unsupported fsync'), { code: 'EINVAL' });
  };
  try {
    const operation = stagePreviousFile({ journalDir, index: 1, type: 'file', target });
    assert.equal(operation.existed, true);
    assert.ok(operation.backup && fs.existsSync(operation.backup));
    assert.equal(fs.readFileSync(operation.backup, 'utf8'), 'current');
  } finally {
    fs.fsyncSync = originalFsync;
  }
});

test('a normal journal staging still succeeds', () => {
  const { target, journalDir } = fixture('normal');
  const operation = stagePreviousFile({ journalDir, index: 2, type: 'file', target });
  assert.equal(operation.existed, true);
  assert.equal(fs.readFileSync(operation.backup, 'utf8'), 'current');
});
