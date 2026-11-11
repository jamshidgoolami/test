import fs from 'node:fs';
import path from 'node:path';

const failInstallAt = Number(process.env.NETWATCH_TEST_FAIL_INSTALL_AT);
const crashRollbackAfter = Number(process.env.NETWATCH_TEST_CRASH_ROLLBACK_AFTER);
const original = fs.renameSync;
let installCount = 0;
let rollbackCount = 0;

function isInstallTarget(dest) {
  return (
    dest.endsWith('netwatch.db') ||
    dest.endsWith('.mbtiles') ||
    dest.endsWith('device-credentials.key') ||
    dest.includes(`${path.sep}attachments${path.sep}`)
  );
}

fs.renameSync = function crashDuringRollback(from, to) {
  const dest = String(to || '');
  if (isInstallTarget(dest)) {
    installCount += 1;
    if (Number.isFinite(failInstallAt) && failInstallAt > 0 && installCount === failInstallAt) {
      throw new Error('injected install failure');
    }
  }
  const result = original.apply(this, arguments);
  if (String(from || '').includes('.restore-rollback-')) {
    rollbackCount += 1;
    if (Number.isFinite(crashRollbackAfter) && crashRollbackAfter > 0 && rollbackCount >= crashRollbackAfter) {
      process.kill(process.pid, 'SIGKILL');
    }
  }
  return result;
};
