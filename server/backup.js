/**
 * NetWatch — Facade عمومی سیستم Backup و Restore.
 * پیاده‌سازی در ماژول‌های تخصصی زیر است.
 */
export { APP_VERSION, BACKUP_FORMAT, BACKUP_DIR } from './backup-files.js';
export { isBackupRunning, readRestoreState, restoreStatus } from './backup-state.js';
export { createBackup } from './backup-create.js';
export { verifyBackup } from './backup-validation.js';
export { restoreBackup } from './backup-restore.js';
export { listBackups, pruneBackupsByPolicy, pruneBackups } from './backup-retention.js';
export {
  runCheckpoint,
  startBackupScheduler,
  stopBackupScheduler,
  backupStatus,
} from './backup-scheduler.js';
