/**
 * NetWatch — وضعیت جاری Backup/Restore و فایل وضعیت Restore.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';
import { logEvent } from './logger.mjs';
import { ensureDir, writeJsonDurable, RESTORE_STATE_FILE } from './backup-files.js';

let backupInProgress = false;
let restoreInProgress = false;

export function isBackupRunning() {
  return backupInProgress;
}

export function isRestoreRunning() {
  return restoreInProgress;
}

export function setBackupRunning(value) {
  backupInProgress = !!value;
}

export function setRestoreRunning(value) {
  restoreInProgress = !!value;
}

function restoreStatePath() {
  return path.join(DATA_DIR, RESTORE_STATE_FILE);
}

function readRestoreState() {
  try {
    return JSON.parse(fs.readFileSync(restoreStatePath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeRestoreStateStrict(patch) {
  ensureDir(DATA_DIR);
  // فایل وضعیت باید پیش از تغییر فایل اصلی روی دیسک باشد؛ وگرنه پس از
  // Crash نمی‌فهمیم بازیابی در چه مرحله‌ای بوده است. برای Journal، خطای نوشتن
  // باید عملیات را متوقف کند؛ نتیجهٔ گمراه‌کننده پذیرفته نیست.
  writeJsonDurable(restoreStatePath(), { ...(readRestoreState() || {}), ...patch });
}

function writeRestoreState(patch) {
  try {
    writeRestoreStateStrict(patch);
  } catch (e) {
    logEvent('warn', 'restore_state_write_failed', { message: e?.message });
  }
}

/** وضعیت آخرین/جاری بازیابی برای API و رابط کاربری */
function restoreStatus() {
  const state = readRestoreState();
  if (!state) return { status: 'never', inProgress: false };
  return {
    ...state,
    inProgress: state.status === 'in_progress',
    stale: state.status === 'in_progress' && Date.now() - Number(state.updatedAt || 0) > 10 * 60 * 1000,
  };
}


export { readRestoreState, writeRestoreState, writeRestoreStateStrict, restoreStatus };
