/**
 * NetWatch — API تجهیزات
 */
import express from 'express';
import { db, getSettings } from '../db.js';
import {
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  deleteDevices,
  getDeviceAccessPassword,
  parseListQuery,
  setDeviceGroups,
} from '../store.js';
import { routePermission, requirePermission, hasPermission } from '../permissions.js';
import { spreadsheetUpload as upload } from '../upload.js';
import { probeTargetGuard } from '../probe-guard.js';
import { probeQueue, getProbeBatch } from '../probe-queue.js';
import { cleanupDeviceAttachmentFiles } from '../attachments.js';
import { importErrorStatus, syncVaultCredential } from '../services/device-access.js';
import { seriesFor, seriesWindowFor } from '../services/device-series.js';
import { mapPayload, sparklinesPayload } from '../services/device-views.js';
import {
  buildDeviceExport,
  buildDeviceTemplate,
  previewDeviceImport,
  commitDeviceImport,
  buildGeoExport,
  importGeoFile,
} from '../services/device-transfer.js';
import { applyBulkMutation, startBulkProbe, updatePositions } from '../services/device-bulk.js';
import { clamp, pingDevice, probeStatus } from '../services/device-probe.js';
import {
  outagesPayload,
  availabilityPayload,
  samplesPayload,
  healthPayload,
  maintenancePayload,
} from '../services/device-history.js';

const router = express.Router();

// خواندن با devices:read و هر تغییر با devices:write (Viewer فقط می‌خواند).
router.use(routePermission({ read: 'devices:read', write: 'devices:write' }));

router.get('/', (req, res) => {
  const filters = parseListQuery(req.query);
  res.json(listDevices(filters));
});

router.get('/meta', (_req, res) => {
  const settings = getSettings();
  res.json({
    // شمارش تجهیزاتی که پینگشان از آستانهٔ مجاز بالا‌تر است (برای نمایش فیلتر «پینگ بالا»)
    highLatency: db
      .prepare(
        'SELECT COUNT(*) AS c FROM devices WHERE enabled = 1 AND last_rtt_ms IS NOT NULL AND last_rtt_ms > COALESCE(latency_threshold, ?)'
      )
      .get(settings.latency_threshold).c,
    // شمارش گروه بر اساس عضویت چندگانه (با در نظر گرفتن ستون قدیمی group_id)
    groups: db
      .prepare(
        `SELECT g.*, (SELECT COUNT(DISTINCT d.id) FROM devices d WHERE d.group_id = g.id
           OR EXISTS (SELECT 1 FROM device_group_members m WHERE m.device_id = d.id AND m.group_id = g.id)) AS device_count
         FROM groups g ORDER BY g.name`
      )
      .all(),
    tags: db
      .prepare(
        'SELECT t.*, (SELECT COUNT(*) FROM device_tags dt WHERE dt.tag_id = t.id) AS device_count FROM tags t ORDER BY t.name'
      )
      .all(),
    types: db
      .prepare('SELECT device_type AS value, COUNT(*) AS count FROM devices GROUP BY device_type ORDER BY count DESC')
      .all(),
    // فهرست مرجع انواع تجهیز (قابل مدیریت در تنظیمات) — حتی نوع بدون تجهیز.
    deviceTypes: db
      .prepare(
        `SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM devices d WHERE d.device_type = t.name) AS device_count
         FROM device_types t ORDER BY t.name`
      )
      .all(),
    locations: db
      .prepare(
        "SELECT location AS value, COUNT(*) AS count FROM devices WHERE location != '' GROUP BY location ORDER BY count DESC"
      )
      .all(),
    vendors: db
      .prepare(
        "SELECT vendor AS value, COUNT(*) AS count FROM devices WHERE vendor != '' GROUP BY vendor ORDER BY count DESC"
      )
      .all(),
    priorities: db.prepare('SELECT priority AS value, COUNT(*) AS count FROM devices GROUP BY priority').all(),
    layers: db.prepare('SELECT * FROM map_layers ORDER BY is_default DESC, name').all(),
    settings,
  });
});

router.get('/export', async (req, res) => {
  const { format, buffer } = await buildDeviceExport(req.query);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    'Content-Type',
    format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="netwatch-devices-${stamp}.${format}"`);
  res.send(buffer);
});

router.get('/template', async (req, res) => {
  const { format, buffer } = await buildDeviceTemplate(req.query);
  res.setHeader(
    'Content-Type',
    format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="netwatch-devices-template.${format}"`);
  res.send(buffer);
});

/** پیش‌نمایش ورود گروهی از فایل */
router.post('/import/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی دریافت نشد' });
  try {
    res.json(await previewDeviceImport(req.file));
  } catch (e) {
    res.status(importErrorStatus(e)).json({ error: `خطا در خواندن فایل: ${e.message}` });
  }
});

/** ثبت نهایی ورود گروهی */
router.post('/import/commit', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی دریافت نشد' });
  const onlyValid = String(req.body?.onlyValid ?? '1') !== '0';
  try {
    const result = await commitDeviceImport(req.file, { onlyValid });
    res.json({ inserted: result.inserted, failed: [], atomic: true, skipped: result.skipped });
  } catch (e) {
    res.status(importErrorStatus(e)).json({
      error: `ورود گروهی انجام نشد و هیچ تغییری ثبت نگردید: ${e.message}`,
      rolledBack: true,
    });
  }
});

/**
 * خروجی مختصات جغرافیایی.
 *
 * با `markers=1` علامت‌های نقشه هم در همان فایل می‌آیند و ستون «نوع رکورد»
 * تجهیز را از علامت جدا می‌کند؛ پارامترهای `group` و `types` فهرست را به گروه
 * تجهیزات و انواع علامت انتخاب‌شده در دیالوگ صفحهٔ نقشه محدود می‌کنند.
 */
router.get('/export/geo', async (req, res) => {
  const { format, buffer } = await buildGeoExport(req.query);
  res.setHeader(
    'Content-Type',
    format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="netwatch-locations.${format}"`);
  res.send(buffer);
});

/** ورود مختصات جغرافیایی */
router.post('/import/geo', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی دریافت نشد' });
  try {
    res.json(await importGeoFile(req.file));
  } catch (e) {
    res.status(400).json({ error: `خطا در خواندن فایل: ${e.message}` });
  }
});

/* --------------------------- عملیات گروهی --------------------------- */

router.post('/bulk', (req, res) => {
  const { ids = [], action, payload = {} } = req.body || {};
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
  if (!list.length) return res.status(400).json({ error: 'هیچ تجهیزی انتخاب نشده است' });
  // سقف ورودی گروهی: درخواست با ده‌ها‌هزار شناسه نه منطقی است و نه باید
  // تراکنشی با هزاران پارامتر SQL بسازد.
  if (list.length > 5000)
    return res.status(413).json({ error: 'تعداد تجهیزات انتخابی برای عملیات گروهی بیش از حد مجاز (۵۰۰۰) است.' });
  // Probe (اسکن فعال) نوشتن دیتابیس نیست و به‌صورت غیرهمگام اجرا می‌شود؛ پیش از
  // تراکنش و جداگانه رسیدگی می‌شود.
  if (action === 'ping') {
    if (!hasPermission(req.user, 'probe:run'))
      return res.status(403).json({ error: 'شما مجوز انجام Probe را ندارید.' });
    if (list.length > MAX_BULK_PROBE) {
      return res.status(413).json({ error: `هر درخواست Ping گروهی حداکثر ${MAX_BULK_PROBE} تجهیز را می‌پذیرد.` });
    }
    return res.status(202).json(startBulkProbe({ list, user: req.user }));
  }
  try {
    const affected = applyBulkMutation({ list, action, payload });
    res.json({ affected, action });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

/** وضعیت Job گروهی Probe (قابل پیگیری پس از بسته‌شدن اتصال اولیه) */
router.get('/bulk/probe/:jobId', (req, res) => {
  const job = getProbeBatch(String(req.params.jobId));
  if (!job) return res.status(404).json({ error: 'Job یافت نشد یا منقضی شده است.' });
  if (job.owner != null && req.user?.role !== 'admin' && Number(job.owner) !== Number(req.user?.id)) {
    return res.status(403).json({ error: 'این Job متعلق به کاربر دیگری است.' });
  }
  const { owner: _owner, ...payload } = job;
  return res.json(payload);
});

/** به‌روزرسانی سریع موقعیت روی نقشه */
router.post('/positions', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  try {
    const n = updatePositions(items);
    res.json({ updated: n });
  } catch (e) {
    return res.status(400).json({ error: `ثبت موقعیت‌ها انجام نشد: ${e.message}` });
  }
});

/** سری نمونه‌ای سبک برای نمودار کارت‌های فهرست تجهیزات */
router.get('/sparklines', (req, res) => {
  res.json(sparklinesPayload(req.query));
});

/* --------------------------- نقشه --------------------------- */

router.get('/map', (req, res) => {
  res.json(mapPayload(req.query));
});

/* --------------------------- CRUD --------------------------- */

/**
 * دریافت صریح اعتبارنامه برای کپی در صفحهٔ جزئیات. علاوه بر مجوز ویرایش
 * تجهیزات، مجوز اختصاصی `credentials:reveal` لازم است؛ Operator به‌صورت
 * پیش‌فرض این مجوز را ندارد و فقط Administrator یا کاربر با اعطای صریح مدیر
 * می‌تواند رمز واقعی را ببیند. هیچ پاسخی کش نمی‌شود.
 */
router.get('/:id/credentials', requirePermission('devices:write', 'credentials:reveal'), (req, res) => {
  const device = getDevice(req.params.id, { withTags: false });
  if (!device) return res.status(404).json({ error: 'تجهیز یافت نشد' });
  try {
    const password = getDeviceAccessPassword(device.id);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.json({ username: device.accessUsername || '', password: password ?? '' });
  } catch {
    res.status(500).json({ error: 'خواندن اعتبارنامه ممکن نشد؛ کلید رمزنگاری را بررسی کنید.' });
  }
});

router.get('/:id', (req, res) => {
  const d = getDevice(req.params.id);
  if (!d) return res.status(404).json({ error: 'تجهیز یافت نشد' });
  const s = getSettings();
  const interval = d.pingInterval || s.ping_interval;
  res.json({
    ...d,
    effective: {
      pingInterval: interval,
      timeoutMs: d.timeoutMs || s.timeout_ms,
      packetCount: d.packetCount || s.packet_count,
      retries: d.retries ?? s.retries,
      latencyThreshold: d.latencyThreshold ?? s.latency_threshold,
      lossThreshold: d.lossThreshold ?? s.loss_threshold,
    },
    stats: {
      outages: d.outageCount || 0,
      openOutage: d.currentOutageStartedAt
        ? Math.max(0, Math.round((Date.now() - d.currentOutageStartedAt) / 1000))
        : null,
      packets: { sent: d.totalChecks, received: d.successCount, lost: d.failCount },
    },
  });
});

router.post('/', (req, res) => {
  try {
    const d = createDevice(req.body || {});
    syncVaultCredential(d.id, req.body || {}, req.user?.username || '');
    res.status(201).json(d);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const d = updateDevice(req.params.id, req.body || {});
    if (!d) return res.status(404).json({ error: 'تجهیز یافت نشد' });
    syncVaultCredential(d.id, req.body || {}, req.user?.username || '');
    res.json(d);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const d = updateDevice(req.params.id, req.body || {});
    if (!d) return res.status(404).json({ error: 'تجهیز یافت نشد' });
    syncVaultCredential(d.id, req.body || {}, req.user?.username || '');
    res.json(d);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  const attachments = db
    .prepare('SELECT stored_name FROM device_attachments WHERE device_id = ?')
    .all(Number(req.params.id));
  const n = deleteDevices([req.params.id]);
  if (!n) return res.status(404).json({ error: 'تجهیز یافت نشد' });
  cleanupDeviceAttachmentFiles(attachments);
  res.json({ deleted: n });
});

/* ------------------------- عضویت گروهی چندگانه ------------------------- */

router.put('/:id/groups', (req, res) => {
  const device = getDevice(req.params.id, { withTags: false });
  if (!device) return res.status(404).json({ error: 'تجهیز یافت نشد' });
  // هر تجهیز فقط عضو یک گروه است؛ ورودی چندگانه به اولین شناسه محدود می‌شود.
  const ids = Array.isArray(req.body?.groupIds) ? req.body.groupIds.slice(0, 1) : [];
  try {
    setDeviceGroups(device.id, ids);
    res.json(getDevice(device.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* --------------------------- بررسی لحظه‌ای --------------------------- */

const MAX_BULK_PROBE = 500;

/**
 * AbortSignal درخواست: اگر کلاینت پیش از پایان قطع شود، منتظر این Probe حذف
 * می‌شود. کار مشترک (مثلاً Probe در جریان موتور) با لغو یک کلاینت متوقف
 * نمی‌شود تا نتیجه در پایگاه‌داده نیمه‌کاره نماند.
 */
function requestSignal(req, res) {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once('close', onClose);
  return { signal: controller.signal, cleanup: () => res.removeListener('close', onClose) };
}

router.post('/:id/ping', requirePermission('probe:run'), probeTargetGuard, async (req, res) => {
  const d = getDevice(req.params.id, { withTags: false });
  if (!d) return res.status(404).json({ error: 'تجهیز یافت نشد' });
  const { signal, cleanup } = requestSignal(req, res);
  try {
    const body = req.body || {};
    const before = { ...d };
    const result = await probeQueue.submit(
      `device:${d.id}:manual`,
      async ({ signal: jobSignal }) => {
        if (body.mode && body.mode !== 'engine') {
          const { icmpPing, tcpPing } = await import('../ping.js');
          const timeoutMs = clamp(body.timeout || d.timeoutMs || d.effective?.timeoutMs || 1200, 100, 15000);
          const count = clamp(body.count || 1, 1, 10);
          const port = clamp(body.port || 80, 1, 65535);
          if (body.mode === 'tcp') return tcpPing(d.ip, { timeoutMs, count: 1, port, signal: jobSignal });
          if (body.mode === 'icmp') return icmpPing(d.ip, { timeoutMs, count, signal: jobSignal });
        }
        return pingDevice(d.id, { manual: true, source: 'manual', signal: jobSignal });
      },
      { signal, timeoutMs: 60000 }
    );
    const after = getDevice(d.id);
    res.json({ result, device: after, before: { status: before.status, lastRtt: before.lastRtt } });
  } catch (e) {
    const status = probeStatus(e);
    if (status === 499) return res.status(499).json({ error: 'درخواست لغو شد.', code: 'PROBE_CANCELLED' });
    res.status(status).json({
      error: status === 409 ? e.message : `خطا در ارسال Ping: ${e.message}`,
      code: e?.code || undefined,
    });
  } finally {
    cleanup();
  }
});

/* ------------------------- بررسی زندهٔ لحظه‌ای ------------------------- */

// بررسی سبک برای «پنجرهٔ شناور پینگ»: نتیجه را برمی‌گرداند اما هیچ نمونه‌ای ثبت
// نمی‌کند؛ در غیر این صورت بررسی هر یک ثانیه، آمار، دسترس‌پذیری و رکوردهای قطعی
// را آلوده می‌کرد.
router.get('/:id/probe', requirePermission('probe:run'), probeTargetGuard, async (req, res) => {
  const d = getDevice(req.params.id, { withTags: false });
  if (!d) return res.status(404).json({ error: 'تجهیز یافت نشد' });
  const s = getSettings();
  const requested = String(req.query.mode || s.engine_mode);
  const mode = ['icmp', 'tcp', 'simulate'].includes(requested) ? requested : 'simulate';
  const timeoutMs = clamp(req.query.timeout ?? d.timeoutMs ?? s.timeout_ms, 100, 10000);
  const port = clamp(req.query.port ?? s.tcp_port, 1, 65535);
  const { signal, cleanup } = requestSignal(req, res);
  // کلید شامل حالت/پورت/مهلت است تا دو بررسی متفاوت با هم قاطی نشوند.
  const key = `live:${d.id}:${mode}:${port}:${timeoutMs}`;
  try {
    const result = await probeQueue.submit(
      key,
      async ({ signal: jobSignal }) => {
        if (mode === 'icmp') {
          const { icmpPing } = await import('../ping.js');
          return icmpPing(d.ip, { timeoutMs, count: 1, signal: jobSignal });
        }
        if (mode === 'tcp') {
          const { tcpPing } = await import('../ping.js');
          return tcpPing(d.ip, { timeoutMs, count: 1, port, signal: jobSignal });
        }
        if (d.status === 'offline') {
          // تجهیزی که در وضعیت قطع است، در حالت شبیه‌سازی هم نباید پاسخ موفق بدهد؛
          // پیش‌تر پنجرهٔ پینگ زنده برای تجهیزات قطع، مقدار و نمودار «وصل» نشان می‌داد.
          return {
            ok: false,
            reachable: false,
            service: 'unknown',
            rtt: null,
            packetsSent: 1,
            packetsRecv: 0,
            lossPct: 100,
            mode: 'simulate',
            error: 'NO_RESPONSE',
          };
        }
        const base = d.avgRtt ?? d.lastRtt ?? 12;
        const jitter = (Math.random() - 0.5) * Math.max(2, base * 0.35);
        const rtt = Math.max(0.3, base + jitter);
        // شبیه‌سازی هرگز سلامت سرویس را ادعا نمی‌کند.
        return {
          ok: true,
          reachable: true,
          service: 'unknown',
          rtt: Math.round(rtt * 100) / 100,
          packetsSent: 1,
          packetsRecv: 1,
          lossPct: 0,
          mode: 'simulate',
        };
      },
      { signal, timeoutMs: timeoutMs * 3 + 3000, cancelWhenNoWaiters: true }
    );
    res.json({
      result: { ...result, at: Date.now() },
      deviceId: d.id,
      name: d.name,
      ip: d.ip,
      threshold: d.latencyThreshold ?? s.latency_threshold,
    });
  } catch (e) {
    const status = probeStatus(e);
    if (status === 499) return res.status(499).json({ error: 'درخواست لغو شد.', code: 'PROBE_CANCELLED' });
    res.status(status).json({ error: `بررسی زنده ناموفق بود: ${e.message}`, code: e?.code || undefined });
  } finally {
    cleanup();
  }
});

/* --------------------------- تاریخچه --------------------------- */

router.get('/:id/series', (req, res) => {
  try {
    if (req.query.from != null || req.query.to != null) {
      res.json(seriesWindowFor(req.params.id, req.query.from, req.query.to ?? Date.now(), req.query.bucket));
      return;
    }
    res.json(seriesFor(req.params.id, String(req.query.range || '1h'), req.query.span));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message, code: error.code });
  }
});

router.get('/:id/outages', (req, res) => {
  res.json(outagesPayload(req.params.id, req.query));
});

router.get('/:id/availability', (req, res) => {
  res.json(availabilityPayload(req.params.id, req.query));
});

router.get('/:id/samples', (req, res) => {
  res.json(samplesPayload(req.params.id, req.query));
});

/** نمای کلی سلامت تجهیز برای سربرگ صفحه جزئیات */
router.get('/:id/health', (req, res) => {
  const body = healthPayload(req.params.id);
  if (!body) return res.status(404).json({ error: 'تجهیز یافت نشد' });
  res.json(body);
});

router.get('/:id/maintenance', (req, res) => {
  res.json(maintenancePayload(req.params.id));
});

export { pingDevice };
export default router;
