/**
 * NetWatch — عملیات گروهی تجهیزات
 * ----------------------------------------------------------------
 * Bulk mutation، شروع Bulk Probe و ثبت موقعیت‌های نقشه در این ماژول
 * اجرا می‌شوند. Routeها فقط ورودی را اعتبارسنجی و پاسخ/Status Code را
 * تعیین می‌کنند. تراکنش‌ها و پیام‌های Engine Log دقیقاً همان قبلی هستند.
 */
import { db, transaction } from '../db.js';
import { deleteDevices, closeDeviceMonitoringState, attachTags, groupByName } from '../store.js';
import { cleanupDeviceAttachmentFiles } from '../attachments.js';
import { allowedProbeDeviceIds } from '../probe-guard.js';
import { probeQueue, createProbeBatch, recordProbeBatchResult } from '../probe-queue.js';
import { pingDevice } from './device-probe.js';

/** شروع Probe گروهی از طریق صف مرکزی؛ کاربر و مجوز در Route بررسی شده‌اند. */
export function startBulkProbe({ list, user }) {
  const ph = list.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, ip FROM devices WHERE id IN (${ph})`).all(...list);
  const allowed = allowedProbeDeviceIds(rows);
  const skipped = rows.length - allowed.length;
  // عملیات طولانی به یک Job قابل پیگیری تبدیل می‌شود؛ هر Probe از صف مرکزی
  // با سقف هم‌زمانی/ظرفیت عبور می‌کند و هرگز Promise.all نامحدود ساخته نمی‌شود.
  const job = createProbeBatch({ total: allowed.length, skipped, owner: user?.id ?? null });
  if (!allowed.length) {
    job.status = 'done';
    job.finishedAt = Date.now();
  }
  for (const id of allowed) {
    probeQueue
      .submit(`device:${id}:manual`, ({ signal }) => pingDevice(id, { manual: true, source: 'manual', signal }), {
        timeoutMs: 60000,
      })
      .then((result) => recordProbeBatchResult(job.id, { deviceId: id, ok: result?.ok }))
      .catch((error) => recordProbeBatchResult(job.id, { deviceId: id, error: error?.message || String(error) }));
  }
  return {
    jobId: job.id,
    statusUrl: `/api/devices/bulk/probe/${job.id}`,
    queued: allowed.length,
    affected: allowed.length,
    skipped,
    total: rows.length,
  };
}

/** اجرای اتمیک تغییرات گروهی؛ خطای ناشناخته همان‌طور که هست پرتاب می‌شود. */
export function applyBulkMutation({ list, action, payload = {} }) {
  const ph = list.map(() => '?').join(',');
  // عملیات گروهی می‌تواند روی صدها تجهیز اثر بگذارد؛ اتمیک است تا خطای میانی
  // فقط بخشی از تجهیزات را تغییر ندهد.
  return transaction(
    () => {
      let affected;
      switch (action) {
        case 'enable':
          affected = db
            .prepare(`UPDATE devices SET enabled=1, next_check_at=0, updated_at=? WHERE id IN (${ph})`)
            .run(Date.now(), ...list).changes;
          break;
        case 'disable':
          affected = db
            .prepare(`UPDATE devices SET enabled=0, updated_at=? WHERE id IN (${ph})`)
            .run(Date.now(), ...list).changes;
          // قطعی باز و هشدارهای فعال نباید برای تجهیز خارج‌شده از پایش باقی بمانند
          for (const id of list) closeDeviceMonitoringState(id);
          break;
        case 'monitoring_on':
          affected = db
            .prepare(`UPDATE devices SET monitoring_enabled=1, next_check_at=0, updated_at=? WHERE id IN (${ph})`)
            .run(Date.now(), ...list).changes;
          break;
        case 'monitoring_off':
          affected = db
            .prepare(`UPDATE devices SET monitoring_enabled=0, updated_at=? WHERE id IN (${ph})`)
            .run(Date.now(), ...list).changes;
          for (const id of list) closeDeviceMonitoringState(id);
          break;
        case 'delete': {
          // فایل‌های پیوست پیش از حذف ردیف‌ها نگه داشته می‌شوند؛ پس از حذف تجهیز،
          // فایل یتیم روی دیسک نمی‌ماند (DB با CASCADE ردیف‌ها را پاک می‌کند).
          const attachmentRows = db
            .prepare(`SELECT stored_name FROM device_attachments WHERE device_id IN (${ph})`)
            .all(...list);
          affected = deleteDevices(list);
          cleanupDeviceAttachmentFiles(attachmentRows);
          break;
        }
        case 'group': {
          const g = groupByName(payload.group);
          affected = g
            ? db
                .prepare(`UPDATE devices SET group_id=?, updated_at=? WHERE id IN (${ph})`)
                .run(g.id, Date.now(), ...list).changes
            : 0;
          // عضویت چندگانه هم ثبت می‌شود تا فهرست گروه‌های تجهیز و گزارش‌ها هم‌گام بمانند.
          if (g) {
            const addMember = db.prepare(
              'INSERT OR IGNORE INTO device_group_members(device_id, group_id, added_at) VALUES (?,?,?)'
            );
            for (const id of list) addMember.run(id, g.id, Date.now());
          }
          break;
        }
        case 'priority':
          affected = db
            .prepare(`UPDATE devices SET priority=?, updated_at=? WHERE id IN (${ph})`)
            .run(payload.priority || 'normal', Date.now(), ...list).changes;
          break;
        case 'interval':
          affected = db
            .prepare(`UPDATE devices SET ping_interval=?, updated_at=? WHERE id IN (${ph})`)
            .run(payload.interval ? Number(payload.interval) : null, Date.now(), ...list).changes;
          break;
        case 'tag': {
          for (const id of list) attachTags(id, [payload.tag]);
          affected = list.length;
          break;
        }
        case 'untag':
          affected = payload.tagId
            ? db
                .prepare(`DELETE FROM device_tags WHERE tag_id=? AND device_id IN (${ph})`)
                .run(Number(payload.tagId), ...list).changes
            : 0;
          break;
        default:
          throw new Error(`عملیات ناشناخته: ${action}`);
      }
      db.prepare('INSERT INTO engine_log(ts, level, message) VALUES (?,?,?)').run(
        Date.now(),
        'info',
        `عملیات گروهی «${action}» روی ${affected} تجهیز اجرا شد.`
      );
      return affected;
    },
    { label: 'devices.bulk' }
  );
}

/** ثبت اتمیک موقعیت‌های نقشه. */
export function updatePositions(items) {
  const upd = db.prepare(
    'UPDATE devices SET latitude=?, longitude=?, map_layer_id=COALESCE(?, map_layer_id), updated_at=? WHERE id=?'
  );
  // جابه‌جایی روی نقشه یک عملیات واحد است؛ مختصات باید همه یا هیچ‌کدام ثبت شوند.
  return transaction(
    () => {
      let count = 0;
      for (const it of items) {
        const lat = it.latitude == null ? null : Number(it.latitude);
        const lng = it.longitude == null ? null : Number(it.longitude);
        count += upd.run(lat, lng, it.mapLayerId ?? null, Date.now(), Number(it.id)).changes;
      }
      return count;
    },
    { label: 'devices.positions' }
  );
}
