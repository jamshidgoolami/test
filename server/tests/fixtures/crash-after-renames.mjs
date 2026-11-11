import fs from 'node:fs';
import path from 'node:path';

function pathSep() {
  return path.sep;
}

const limit = Number(process.env.NETWATCH_TEST_CRASH_AFTER_RENAMES);
if (Number.isFinite(limit) && limit > 0) {
  const original = fs.renameSync;
  let count = 0;
  fs.renameSync = function crashAfterRename(...args) {
    const result = original.apply(this, args);
    const dest = String(args[1] || '');
    // Renameهای فایل وضعیت/Journal نباید در شمارش نصب فایل‌ها بیایند.
    if (
      dest.endsWith('netwatch.db') ||
      dest.endsWith('.mbtiles') ||
      dest.endsWith('device-credentials.key') ||
      dest.includes(`${pathSep()}attachments${pathSep()}`)
    ) {
      count += 1;
      if (count >= limit) process.kill(process.pid, 'SIGKILL');
    }
    return result;
  };
}
