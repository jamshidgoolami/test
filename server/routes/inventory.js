/**
 * NetWatch — API دسته‌بندی، تگ‌ها، لایه‌های نقشه و کاشی‌های آفلاین
 */
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, MBTILES_DIR, getSettings, transaction } from '../db.js';
import * as mbtiles from '../mbtiles.js';
import { routePermission } from '../permissions.js';
import { mbtilesOnly, mbtilesLimits, UPLOAD_TMP_DIR, ensureUploadTmpDir } from '../upload.js';
import { runJob } from '../jobs.js';
import { fileGuardMessage } from '../file-guard.js';
import { logEvent } from '../logger.mjs';
import { parseIdList } from '../validation.js';

const router = express.Router();

router.use(routePermission({ read: 'inventory:read', write: 'inventory:write' }));

const MIN_FREE_BYTES = 256 * 1024 * 1024; // حداقل فضای آزاد لازم روی دیسک

/** فایل نقشهٔ نامعتبر خطای کاربر است (۴۰۰)، نه خرابی سرور (۵۰۰). */
function mapFileErrorStatus(error) {
  const status = Number(error?.status);
  return [413, 415, 429, 503, 504, 507].includes(status) ? status : 400;
}

/**
 * فایل ابتدا در پوشهٔ موقت `data/tmp` (۰۷۰۰) نوشته می‌شود و فقط پس از
 * اعتبارسنجی محتوا به `data/mbtiles` منتقل می‌شود. بنابراین فایل نیمه‌کاره یا
 * نامعتبر هرگز در مسیر قابل‌سرو قرار نمی‌گیرد و نام فایل از ورودی کاربر ساخته
 * نمی‌شود (فقط نام پایهٔ پاک‌شده + مُهر زمانی + شناسهٔ تصادفی).
 */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureUploadTmpDir();
      const st = fs.statfsSync(UPLOAD_TMP_DIR);
      if (Number(st.bsize) * Number(st.bavail) < MIN_FREE_BYTES) {
        const err = new Error('فضای ذخیره‌سازی سرور کافی نیست.');
        err.code = 'STORAGE_LOW';
        err.status = 507;
        return cb(err);
      }
    } catch {
      /* اگر بررسی فضا ممکن نبود، بارگذاری متوقف نمی‌شود */
    }
    return cb(null, ensureUploadTmpDir());
  },
  filename: (_req, _file, cb) => {
    // نام موقت کاملاً تولیدی است؛ هیچ بخشی از نام کاربر در مسیر نوشتن نمی‌آید.
    cb(null, `${Date.now()}-${crypto.randomUUID()}.upload`);
  },
});

// پسوند پیش از نوشتن فایل بررسی می‌شود؛ پیش‌تر یک فایل ۲ گیگابایتی بی‌ربط
// کاملاً روی دیسک نوشته می‌شد و بعد حذف می‌گشت. سقف فیلد/بخش از upload.js و
// فضای آزاد دیسک همین‌جا کنترل می‌شود؛ حجم فایل نقشه محدودیتی ندارد.
const upload = multer({ storage, fileFilter: mbtilesOnly, limits: mbtilesLimits });

/** آیا فایل، هدر SQLite معتبر دارد؟ (فایل غیرمرتبط پیش از ثبت رد می‌شود) */
function hasSqliteHeader(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(16);
      const read = fs.readSync(fd, buf, 0, 16, 0);
      return read === 16 && buf.toString('utf8') === 'SQLite format 3\u0000';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** مرزگذاری مقادیر ورودی لایه (نام‌ها از فیلدهای multipart می‌آیند و محدودیت بدنهٔ JSON شاملشان نیست) */
function text(v, max) {
  return String(v ?? '').trim().slice(0, max);
}
function zoom(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(24, Math.max(0, Math.round(n)));
}

/* ------------------------------ گروه‌ها ------------------------------ */

router.get('/groups', (_req, res) => {
  res.json({
    items: db
      .prepare(
        `SELECT g.*, COUNT(DISTINCT d.id) AS device_count,
                -- «وصل» شامل تجهیزات دارای اختلال هم می‌شود (هم‌راستا با داشبورد)
                SUM(CASE WHEN d.status IN ('online','warning') THEN 1 ELSE 0 END) AS online,
                SUM(CASE WHEN d.status='offline' THEN 1 ELSE 0 END) AS offline,
                SUM(CASE WHEN d.status='warning' THEN 1 ELSE 0 END) AS warning,
                ROUND(AVG(d.uptime_pct),2) AS uptime
         FROM groups g
         LEFT JOIN devices d ON d.group_id = g.id
           OR EXISTS (SELECT 1 FROM device_group_members m WHERE m.device_id = d.id AND m.group_id = g.id)
         GROUP BY g.id ORDER BY g.name`
      )
      .all(),
  });
});

router.post('/groups', (req, res) => {
  const { name, description = '', color = '#3b82f6' } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'نام گروه الزامی است' });
  const exists = db.prepare('SELECT id FROM groups WHERE name = ?').get(String(name).trim());
  if (exists) return res.status(400).json({ error: 'گروهی با این نام وجود دارد' });
  const r = db
    .prepare('INSERT INTO groups(name, description, color, created_at) VALUES (?,?,?,?)')
    .run(String(name).trim(), String(description), String(color), Date.now());
  res.status(201).json(db.prepare('SELECT * FROM groups WHERE id=?').get(Number(r.lastInsertRowid)));
});

router.put('/groups/:id', (req, res) => {
  const b = req.body || {};
  const n = db
    .prepare('UPDATE groups SET name=COALESCE(?, name), description=COALESCE(?, description), color=COALESCE(?, color) WHERE id=?')
    .run(b.name ?? null, b.description ?? null, b.color ?? null, Number(req.params.id)).changes;
  res.json({ updated: n });
});

router.delete('/groups/:id', (req, res) => {
  const id = Number(req.params.id);
  const move = req.query.moveTo ? Number(req.query.moveTo) : null;
  // جابه‌جایی اتمیک: ستون قدیمی و عضویت چندگانه هم‌زمان منتقل می‌شوند؛
  // در غیر این صورت حذف گروه، عضویت‌ها را CASCADE پاک می‌کرد.
  const deleted = transaction(
    () => {
      if (move) {
        db.prepare('UPDATE devices SET group_id = ? WHERE group_id = ?').run(move, id);
        db.prepare(
          'INSERT OR IGNORE INTO device_group_members(device_id, group_id, added_at) SELECT device_id, ?, ? FROM device_group_members WHERE group_id = ?'
        ).run(move, Date.now(), id);
      }
      return db.prepare('DELETE FROM groups WHERE id=?').run(id).changes;
    },
    { label: 'inventory.group.delete' }
  );
  res.json({ deleted });
});

/* ------------------------------ ایستگاه‌ها ------------------------------ */

/**
 * ایستگاه: چند تجهیز هم‌مکان زیرمجموعهٔ یک گروه.
 * فهرست با تعداد تجهیزات عضو برمی‌گردد تا فهرست نقشه بدون پرس‌وجوی اضافه
 * زیرمجموعهٔ هر گروه را بسازد.
 */
router.get('/sites', (_req, res) => {
  res.json({
    items: db
      .prepare(
        `SELECT s.*, g.name AS group_name, COUNT(d.id) AS device_count
         FROM sites s
         LEFT JOIN groups g ON g.id = s.group_id
         LEFT JOIN devices d ON d.site_id = s.id
         GROUP BY s.id
         ORDER BY s.name`
      )
      .all(),
  });
});

/** شناسه‌های معتبر و یکتای تجهیزات یک ایستگاه؛ ورودی نامعتبر خطای کاربر است. */
function siteDevices(raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return { error: 'حداقل یک تجهیز برای ایستگاه انتخاب کنید' };
  if (ids.length > 1000) return { error: 'تعداد تجهیزات یک ایستگاه بیش از حد مجاز است' };
  const found = db
    .prepare(`SELECT id FROM devices WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids).length;
  if (found !== ids.length) return { error: 'برخی تجهیزات انتخاب‌شده یافت نشدند' };
  return { ids };
}

router.post('/sites', (req, res) => {
  const name = text(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: 'نام ایستگاه الزامی است' });
  const groupId = req.body?.group_id ? Number(req.body.group_id) : null;
  if (groupId && !db.prepare('SELECT id FROM groups WHERE id=?').get(groupId)) {
    return res.status(400).json({ error: 'گروه انتخاب‌شده یافت نشد' });
  }
  const chosen = siteDevices(req.body?.device_ids);
  if (chosen.error) return res.status(400).json({ error: chosen.error });
  const siteId = transaction(
    () => {
      const r = db.prepare('INSERT INTO sites(name, group_id, created_at) VALUES (?,?,?)').run(name, groupId, Date.now());
      const id = Number(r.lastInsertRowid);
      const assign = db.prepare('UPDATE devices SET site_id=?, updated_at=? WHERE id=?');
      for (const deviceId of chosen.ids) assign.run(id, Date.now(), deviceId);
      return id;
    },
    { label: 'inventory.site.create' }
  );
  res.status(201).json({
    ...db
      .prepare('SELECT s.*, g.name AS group_name FROM sites s LEFT JOIN groups g ON g.id = s.group_id WHERE s.id=?')
      .get(siteId),
    device_count: chosen.ids.length,
  });
});

router.put('/sites/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM sites WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'ایستگاه یافت نشد' });
  const name = req.body?.name === undefined ? existing.name : text(req.body.name, 120) || existing.name;
  const groupId =
    req.body?.group_id === undefined ? existing.group_id : req.body.group_id ? Number(req.body.group_id) : null;
  if (groupId && !db.prepare('SELECT id FROM groups WHERE id=?').get(groupId)) {
    return res.status(400).json({ error: 'گروه انتخاب‌شده یافت نشد' });
  }
  const chosen = req.body?.device_ids === undefined ? null : siteDevices(req.body.device_ids);
  if (chosen?.error) return res.status(400).json({ error: chosen.error });
  transaction(
    () => {
      db.prepare('UPDATE sites SET name=?, group_id=? WHERE id=?').run(name, groupId, id);
      if (chosen) {
        db.prepare('UPDATE devices SET site_id=NULL WHERE site_id=?').run(id);
        const assign = db.prepare('UPDATE devices SET site_id=?, updated_at=? WHERE id=?');
        for (const deviceId of chosen.ids) assign.run(id, Date.now(), deviceId);
      }
    },
    { label: 'inventory.site.update' }
  );
  res.json({ updated: 1 });
});

router.delete('/sites/:id', (req, res) => {
  const id = Number(req.params.id);
  // عضویت تجهیزات اول خالی می‌شود تا ایستگاه بدون تجهیز یتیم حذف شود.
  const deleted = transaction(
    () => {
      db.prepare('UPDATE devices SET site_id=NULL WHERE site_id=?').run(id);
      return db.prepare('DELETE FROM sites WHERE id=?').run(id).changes;
    },
    { label: 'inventory.site.delete' }
  );
  res.json({ deleted });
});

/* ------------------------------- تگ‌ها ------------------------------- */

router.get('/tags', (_req, res) => {
  res.json({
    items: db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM device_tags dt WHERE dt.tag_id = t.id) AS device_count
         FROM tags t ORDER BY t.name`
      )
      .all(),
  });
});

router.post('/tags', (req, res) => {
  const { name, color = '#f59e0b', show_on_map = 1, icon = 'tag' } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'نام تگ الزامی است' });
  const exists = db.prepare('SELECT id FROM tags WHERE name = ?').get(String(name).trim());
  if (exists) return res.status(400).json({ error: 'تگی با این نام وجود دارد' });
  const r = db
    .prepare('INSERT INTO tags(name, color, show_on_map, icon, created_at) VALUES (?,?,?,?,?)')
    .run(String(name).trim(), String(color), Number(show_on_map) ? 1 : 0, String(icon), Date.now());
  res.status(201).json(db.prepare('SELECT * FROM tags WHERE id=?').get(Number(r.lastInsertRowid)));
});

router.put('/tags/:id', (req, res) => {
  const b = req.body || {};
  const n = db
    .prepare('UPDATE tags SET name=COALESCE(?,name), color=COALESCE(?,color), show_on_map=COALESCE(?,show_on_map), icon=COALESCE(?,icon) WHERE id=?')
    .run(b.name ?? null, b.color ?? null, b.show_on_map === undefined ? null : Number(b.show_on_map) ? 1 : 0, b.icon ?? null, Number(req.params.id)).changes;
  res.json({ updated: n });
});

router.delete('/tags/:id', (req, res) => {
  res.json({ deleted: db.prepare('DELETE FROM tags WHERE id=?').run(Number(req.params.id)).changes });
});

/* --------------------------- انواع تجهیز --------------------------- */

// نوع تجهیز روی خود تجهیز به‌صورت متن ذخیره می‌شود؛ این جدول فقط فهرست مرجع
// است تا مدیر بتواند نوع تازه بسازد و در فیلد «نوع تجهیز» ببیند.
router.get('/device-types', (_req, res) => {
  res.json({
    items: db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM devices d WHERE d.device_type = t.name) AS device_count
         FROM device_types t ORDER BY t.name`
      )
      .all(),
  });
});

router.post('/device-types', (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'نام نوع تجهیز الزامی است' });
  if (db.prepare('SELECT id FROM device_types WHERE name = ?').get(name)) {
    return res.status(400).json({ error: 'نوعی با این نام از قبل وجود دارد' });
  }
  const r = db
    .prepare('INSERT INTO device_types(name, color, created_at) VALUES (?,?,?)')
    .run(name, /^#[0-9a-fA-F]{6}$/.test(String(req.body?.color)) ? String(req.body.color) : '#2563eb', Date.now());
  res.status(201).json(db.prepare('SELECT * FROM device_types WHERE id=?').get(Number(r.lastInsertRowid)));
});

router.put('/device-types/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM device_types WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'نوع تجهیز یافت نشد' });
  const name = req.body?.name === undefined ? existing.name : text(req.body.name, 60) || existing.name;
  if (name !== existing.name && db.prepare('SELECT id FROM device_types WHERE name=? AND id!=?').get(name, id)) {
    return res.status(400).json({ error: 'نوعی با این نام از قبل وجود دارد' });
  }
  // تغییر نام باید تجهیزات موجود را هم هم‌گام کند، وگرنه فیلتر نوع قدیمی می‌ماند.
  const updated = transaction(
    () => {
      db.prepare('UPDATE device_types SET name=?, color=? WHERE id=?').run(
        name,
        req.body?.color === undefined ? existing.color : /^#[0-9a-fA-F]{6}$/.test(String(req.body.color)) ? String(req.body.color) : existing.color,
        id
      );
      return name === existing.name
        ? 0
        : db.prepare('UPDATE devices SET device_type=?, updated_at=? WHERE device_type=?').run(name, Date.now(), existing.name).changes;
    },
    { label: 'inventory.deviceType.rename' }
  );
  res.json({ updated, item: db.prepare('SELECT * FROM device_types WHERE id=?').get(id) });
});

router.delete('/device-types/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM device_types WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'نوع تجهیز یافت نشد' });
  const used = db.prepare('SELECT COUNT(*) AS c FROM devices WHERE device_type = ?').get(row.name).c;
  if (used) {
    return res.status(400).json({ error: `این نوع برای ${used} تجهیز ثبت شده است؛ ابتدا نوع آن‌ها را تغییر دهید.` });
  }
  res.json({ deleted: db.prepare('DELETE FROM device_types WHERE id=?').run(id).changes });
});

/** اختصاص/حذف تگ از تجهیز به‌صورت تکی */
router.post('/tags/:tagId/devices', (req, res) => {
  const tagId = Number(req.params.tagId);
  const parsed = parseIdList(req.body?.ids);
  if (parsed.invalid) return res.status(400).json({ error: 'فهرست تجهیزات نامعتبر است.' });
  if (parsed.tooMany) {
    return res.status(413).json({ error: 'تعداد تجهیزات انتخابی برای عملیات تگ بیش از حد مجاز (۴۰۰۰) است.' });
  }
  const ids = parsed.ids;
  const mode = req.body?.mode === 'remove' ? 'remove' : 'add';
  const stmt =
    mode === 'add'
      ? db.prepare('INSERT OR IGNORE INTO device_tags(device_id, tag_id) VALUES (?,?)')
      : db.prepare('DELETE FROM device_tags WHERE device_id=? AND tag_id=?');
  let n = 0;
  for (const id of ids) n += stmt.run(id, tagId).changes;
  res.json({ affected: n, mode });
});

/* --------------------------- لایه‌های نقشه --------------------------- */

router.get('/layers', (_req, res) => {
  // fileInfo بدون COUNT(*) روی جدول کاشی ساخته می‌شود تا باز کردن فهرست لایه‌ها
  // روی فایل MBTiles بزرگ، رشتهٔ اصلی را قفل نکند. تعداد کاشی از DB می‌آید.
  const items = db
    .prepare('SELECT * FROM map_layers ORDER BY is_default DESC, name')
    .all()
    .map((l) => ({ ...l, fileInfo: l.file_name ? mbtiles.info(l.file_name, { countTiles: false }) : null }));
  // فقط نام پوشه برگردانده می‌شود؛ مسیر مطلق سرویس نباید در پاسخ API بیاید.
  res.json({ items, files: mbtiles.listFiles(), tilesDir: path.basename(MBTILES_DIR), settings: getSettings() });
});

/** لایه‌هایی که به یک فایل MBTiles مشخص ارجاع می‌دهند. */
function layersUsingFile(fileName) {
  const safe = path.basename(String(fileName || ''));
  if (!safe || safe !== String(fileName) || !/\.mbtiles$/i.test(safe)) return [];
  return db
    .prepare('SELECT id, name, visible, is_default FROM map_layers WHERE file_name = ? ORDER BY id')
    .all(safe);
}

function mbtilesFileExists(fileName) {
  const safe = path.basename(String(fileName || ''));
  return Boolean(safe) && safe === String(fileName) && fs.existsSync(path.join(MBTILES_DIR, safe));
}

router.post('/layers', async (req, res) => {
  const b = req.body || {};
  const requestedFile = b.file_name ? path.basename(String(b.file_name)).slice(0, 200) : null;
  const requestedKind =
    b.kind === undefined
      ? requestedFile
        ? 'mbtiles'
        : 'empty'
      : ['builtin', 'mbtiles', 'empty'].includes(b.kind)
        ? b.kind
        : 'empty';
  // لایهٔ MBTiles بدون فایل موجود، رکورد یتیم می‌سازد؛ پیش از درج رد می‌شود.
  if (requestedFile && requestedKind !== 'mbtiles') {
    return res.status(400).json({ error: 'فایل MBTiles فقط برای لایهٔ از نوع mbtiles مجاز است.' });
  }
  if (requestedKind === 'mbtiles' && !requestedFile) {
    return res.status(400).json({ error: 'لایهٔ MBTiles باید فایل مشخص داشته باشد.' });
  }
  if (requestedFile && !mbtilesFileExists(requestedFile)) {
    return res.status(400).json({ error: `فایل MBTiles یافت نشد: ${requestedFile}` });
  }
  const r = db
    .prepare(
      'INSERT INTO map_layers(name, description, kind, file_name, min_zoom, max_zoom, attribution, visible, is_default, tile_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      text(b.name, 120) || 'لایه جدید',
      text(b.description, 500),
      requestedKind,
      requestedFile,
      zoom(b.min_zoom, 0),
      zoom(b.max_zoom, 19),
      text(b.attribution, 200),
      b.visible === undefined ? 1 : Number(b.visible) ? 1 : 0,
      0,
      0,
      Date.now()
    );
  const id = Number(r.lastInsertRowid);
  if (requestedFile) {
    // خواندن metadata و شمارش کاشی برای فایل موجود هم در Worker انجام می‌شود
    try {
      const filePath = path.join(MBTILES_DIR, requestedFile);
      if (fs.existsSync(filePath)) {
        const info = await runJob('mbtilesInfo', { filePath }, { timeoutMs: 120000 });
        if (info) {
          db.prepare('UPDATE map_layers SET tile_count=?, min_zoom=?, max_zoom=?, attribution=? WHERE id=?').run(
            info.tileCount || 0,
            info.minzoom ?? 0,
            info.maxzoom ?? 19,
            info.attribution || '',
            id
          );
        }
      }
    } catch {
      /* ثبت لایه حتی اگر خواندن فایل ناموفق باشد؛ کاربر بعداً می‌تواند حذف کند */
    }
  }
  res.status(201).json(db.prepare('SELECT * FROM map_layers WHERE id=?').get(id));
});

router.put('/layers/:id', (req, res) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  const layer = db.prepare('SELECT * FROM map_layers WHERE id=?').get(id);
  if (!layer) return res.status(404).json({ error: 'لایه یافت نشد' });
  if (b.kind !== undefined && !['builtin', 'mbtiles', 'empty'].includes(b.kind)) {
    return res.status(400).json({ error: 'نوع لایه نامعتبر است.' });
  }
  const nextKind = b.kind === undefined ? layer.kind : b.kind;
  const nextFile =
    b.file_name === undefined
      ? nextKind === 'mbtiles'
        ? layer.file_name
        : null
      : b.file_name
        ? path.basename(String(b.file_name)).slice(0, 200)
        : null;
  if (nextKind === 'mbtiles' && !nextFile) {
    return res.status(400).json({ error: 'لایهٔ MBTiles باید فایل مشخص داشته باشد.' });
  }
  if (nextFile && (nextKind !== 'mbtiles' || !mbtilesFileExists(nextFile))) {
    return res.status(400).json({
      error: nextKind !== 'mbtiles' ? 'فایل MBTiles فقط برای لایهٔ mbtiles مجاز است.' : `فایل MBTiles یافت نشد: ${nextFile}`,
    });
  }
  // «صفر کردن پیش‌فرض قبلی + تعیین پیش‌فرض جدید» اتمیک است؛ وگرنه شکست میانی،
  // نقشه را بدون لایهٔ پیش‌فرض رها می‌کرد.
  const n = transaction(() => {
  if (Number(b.is_default)) db.prepare('UPDATE map_layers SET is_default = 0').run();
  return db
    .prepare(
      'UPDATE map_layers SET name=COALESCE(?,name), description=COALESCE(?,description), kind=?, file_name=?, min_zoom=COALESCE(?,min_zoom), max_zoom=COALESCE(?,max_zoom), attribution=COALESCE(?,attribution), visible=COALESCE(?,visible), is_default=COALESCE(?,is_default) WHERE id=?'
    )
    .run(
      b.name === undefined ? null : text(b.name, 120),
      b.description === undefined ? null : text(b.description, 500),
      nextKind,
      nextFile,
      b.min_zoom === undefined ? null : zoom(b.min_zoom, 0),
      b.max_zoom === undefined ? null : zoom(b.max_zoom, 19),
      b.attribution === undefined ? null : text(b.attribution, 200),
      b.visible === undefined ? null : Number(b.visible) ? 1 : 0,
      b.is_default === undefined ? null : Number(b.is_default) ? 1 : 0,
      id
    ).changes;
  }, { label: 'inventory.layer.update' });
  res.json({ updated: n });
});

router.delete('/layers/:id', (req, res) => {
  const id = Number(req.params.id);
  const layer = db.prepare('SELECT * FROM map_layers WHERE id=?').get(id);
  if (!layer) return res.status(404).json({ error: 'لایه یافت نشد' });
  const removeFile = String(req.query.removeFile || '') === '1';
  // فایل فقط وقتی پاک می‌شود که لایهٔ دیگری (فعال یا غیرفعال) از آن استفاده
  // نکند. برای جلوگیری از رکوردِ بدون فایل در صورت خطای میانی، فایل ابتدا
  // به نام موقت تغییر می‌کند، سپس رکورد در تراکنش حذف می‌شود؛ اگر تراکنش
  // شکست بخورد نام فایل به حالت اول برمی‌گردد.
  const othersUseFile = layer.file_name ? layersUsingFile(layer.file_name).filter((l) => l.id !== id) : [];
  const shouldRemoveFile = Boolean(removeFile && layer.file_name && othersUseFile.length === 0);
  const filePath = layer.file_name ? path.join(MBTILES_DIR, layer.file_name) : null;
  const stagedPath = shouldRemoveFile && filePath && fs.existsSync(filePath) ? `${filePath}.deleting-${crypto.randomUUID()}` : null;
  if (stagedPath) {
    try {
      fs.renameSync(filePath, stagedPath);
    } catch (e) {
      logEvent('error', 'map_layer_delete_stage_failed', { layerId: id, message: String(e?.message || e) });
      return res.status(500).json({ error: 'آماده‌سازی حذف فایل نقشه ناموفق بود.' });
    }
  }
  let deleted;
  try {
    deleted = transaction(() => db.prepare('DELETE FROM map_layers WHERE id=?').run(id).changes, {
      label: 'inventory.layer.delete',
    });
  } catch (e) {
    if (stagedPath) {
      try {
        fs.renameSync(stagedPath, filePath);
      } catch {
        /* خطای اصلی گزارش می‌شود؛ فایل موقت برای پاک‌سازی دستی می‌ماند */
      }
    }
    throw e;
  }
  if (!deleted && stagedPath) {
    try {
      fs.renameSync(stagedPath, filePath);
    } catch {
      /* بی‌اثر */
    }
  }
  let fileDeleted = false;
  const fileKept = Boolean(removeFile && layer.file_name && !shouldRemoveFile);
  if (deleted && stagedPath) {
    try {
      fs.unlinkSync(stagedPath);
      fileDeleted = true;
    } catch (e) {
      logEvent('warn', 'map_layer_file_delete_failed', { layerId: id, message: String(e?.message || e) });
    }
  }
  res.json({ deleted, fileDeleted, fileKept });
});

/** بارگذاری فایل .mbtiles (موقت → اعتبارسنجی → انتقال اتمیک) */
router.post('/layers/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی دریافت نشد' });
  const tmpPath = req.file.path;
  let finalPath = null;
  const cleanup = () => {
    for (const file of [tmpPath, finalPath]) {
      if (!file) continue;
      try {
        fs.unlinkSync(file);
      } catch {
        /* بی‌اثر */
      }
    }
  };
  const original = path.basename(String(req.file.originalname || ''));
  if (!/\.mbtiles$/i.test(original)) {
    cleanup();
    return res.status(400).json({ error: 'فقط فایل با پسوند .mbtiles پذیرفته می‌شود' });
  }
  // پسوند به‌تنهایی کافی نیست: امضای واقعی SQLite بررسی می‌شود و سپس خود فایل
  // در Worker به‌صورت read-only باز و جدول کاشی آن خوانده می‌شود.
  if (!hasSqliteHeader(tmpPath)) {
    cleanup();
    return res.status(400).json({ error: 'فایل بارگذاری‌شده یک پایگاه‌دادهٔ SQLite/MBTiles معتبر نیست.' });
  }
  let info;
  try {
    info = await runJob('mbtilesInfo', { filePath: tmpPath }, { timeoutMs: 120000 });
  } catch (e) {
    cleanup();
    return res.status(mapFileErrorStatus(e)).json({ error: `فایل MBTiles معتبر نیست یا خوانده نشد: ${fileGuardMessage(e)}` });
  }
  if (!info || info.tileCount == null) {
    cleanup();
    return res.status(400).json({ error: 'فایل MBTiles معتبر نیست یا جدول کاشی آن خوانده نمی‌شود' });
  }
  // نام نهایی کاملاً تولیدی است (هیچ بخشی از ورودی کاربر در مسیر ذخیره نیست).
  const fileName = `${Date.now()}-${crypto.randomUUID()}.mbtiles`;
  finalPath = path.join(MBTILES_DIR, fileName);
  try {
    fs.renameSync(tmpPath, finalPath);
    // فقط مالک سرویس می‌تواند فایل نقشه را بخواند/تغییر دهد.
    try {
      fs.chmodSync(finalPath, 0o600);
    } catch {
      /* سیستم فایل ممکن است chmod را پشتیبانی نکند */
    }
  } catch (e) {
    cleanup();
    logEvent('error', 'map_layer_store_failed', { message: String(e?.message || e) });
    return res.status(507).json({ error: 'ذخیرهٔ فایل نقشه ناموفق بود.' });
  }
  try {
    const b = req.body || {};
    const r = db
      .prepare(
        'INSERT INTO map_layers(name, description, kind, file_name, min_zoom, max_zoom, attribution, visible, is_default, tile_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        text(b.name, 120) || path.basename(original, '.mbtiles').slice(0, 120),
        text(b.description, 500),
        'mbtiles',
        fileName,
        info.minzoom ?? 0,
        info.maxzoom ?? 19,
        info.attribution || '',
        1,
        0,
        info.tileCount || 0,
        Date.now()
      );
    res.status(201).json({ layer: db.prepare('SELECT * FROM map_layers WHERE id=?').get(Number(r.lastInsertRowid)), info });
  } catch (e) {
    // اگر ثبت پایگاه‌داده شکست بخورد، فایل یتیم نمی‌ماند.
    cleanup();
    res.status(500).json({ error: 'ثبت لایهٔ نقشه ناموفق بود.' });
  }
});

router.get('/layers/:id/info', (req, res) => {
  const layer = db.prepare('SELECT * FROM map_layers WHERE id=?').get(Number(req.params.id));
  if (!layer) return res.status(404).json({ error: 'لایه یافت نشد' });
  res.json({ layer, info: layer.file_name ? mbtiles.info(layer.file_name) : null });
});

/* ------------------------- سرو کاشی آفلاین ------------------------- */

router.get('/tiles/:layerId/:z/:x/:y', (req, res) => {
  const layerId = Number(req.params.layerId);
  const layer = db.prepare('SELECT * FROM map_layers WHERE id=?').get(layerId);
  if (!layer || !layer.file_name) return res.status(404).json({ error: 'لایه فایل ندارد' });
  const yRaw = String(req.params.y);
  const y = Number(yRaw.split('.')[0]);
  const buf = mbtiles.getTile(layer.file_name, Number(req.params.z), Number(req.params.x), y);
  if (!buf) return res.status(404).end();
  // نوع کاشی از امضای خود کاشی/metadata تشخیص داده می‌شود (نه از پسوند آدرس)؛
  // این کار تصاویر JPEG/WebP را هم درست نمایش می‌دهد و درخواست تکراری برای
  // خواندن metadata در هر کاشی انجام نمی‌شود.
  const meta = mbtiles.tileMeta(layer.file_name);
  const format = String(meta?.format || 'png').toLowerCase();
  const type = format === 'jpg'
    ? 'image/jpeg'
    : format === 'webp'
      ? 'image/webp'
      : format === 'pbf'
        ? 'application/x-protobuf'
        : format === 'gif'
          ? 'image/gif'
          : 'image/png';
  res.setHeader('Content-Type', type);
  // کاشی‌های برداری معمولاً gzip شده‌اند؛ با اعلام Content-Encoding مرورگر خودش
  // باز می‌کند و MapLibre بدنهٔ PBF معتبر می‌گیرد. تصمیم بر اساس بایت‌های همین
  // کاشی گرفته می‌شود، نه فقط کاشی اول فایل: در برخی فایل‌ها بخشی از کاشی‌ها
  // (مثلاً کاشی‌های خالی) فشرده نیستند و هدر اشتباه، بدنه را خراب می‌کرد.
  const gzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (gzip) res.setHeader('Content-Encoding', 'gzip');
  // کاشی‌ها پشت نشست هستند؛ کش مشترک/پروکسی نباید نسخهٔ یک کاربر را به
  // کاربر دیگر (حتی ناشناس) بدهد. کش مرورگر همان کاربر کافی است.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(buf);
});

router.get('/mbtiles/files', (_req, res) => {
  res.json({ items: mbtiles.listFiles(), dir: path.basename(MBTILES_DIR) });
});

router.delete('/mbtiles/files/:name', (req, res) => {
  const name = String(req.params.name || '');
  const safe = path.basename(name);
  if (!safe || safe !== name || !/\.mbtiles$/i.test(safe)) {
    return res.status(400).json({ error: 'نام فایل MBTiles نامعتبر است.' });
  }
  const usedBy = layersUsingFile(safe);
  if (usedBy.length) {
    return res.status(409).json({
      error: `این فایل توسط ${usedBy.length} لایه استفاده می‌شود و حذف آن مجاز نیست: ${usedBy
        .map((layer) => layer.name)
        .join('، ')}`,
      layers: usedBy,
    });
  }
  if (!mbtilesFileExists(safe)) return res.status(404).json({ error: 'فایل MBTiles یافت نشد.' });
  const deleted = mbtiles.deleteFile(safe);
  if (!deleted) return res.status(500).json({ error: 'حذف فایل MBTiles ناموفق بود.' });
  res.json({ ok: true, deleted: true });
});

export default router;
