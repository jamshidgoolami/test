/**
 * NetWatch — مخزن اعتبارنامهٔ تجهیزات (سرویس)
 * ----------------------------------------------------------------
 * یک ماژول مستقل که چند اعتبارنامه برای هر تجهیز نگه می‌دارد: SSH، پنل وب،
 * SNMP، کنسول، Wi‑Fi، توکن API و … .
 *
 * قواعد امنیتی که در همین لایه تضمین می‌شوند:
 *   • نام کاربری، رمز و یادداشت با AES-256-GCM و AAD وابسته به شناسهٔ ردیف
 *     رمزنگاری می‌شوند؛ جابه‌جایی ciphertext بین ردیف‌ها شکست می‌خورد.
 *   • رمز خام هرگز در پاسخ فهرست/جزئیات برنمی‌گردد؛ فقط مسیر صریح reveal.
 *   • امتیاز قدرت (۰..۴) و دلایل ضعف در زمان نوشتن محاسبه و ذخیره می‌شوند تا
 *     فیلتر «ضعیف» بدون رمزگشایی همهٔ ردیف‌ها کار کند.
 *   • جست‌وجو روی عنوان/میزبان/برچسب/نام و IP تجهیز انجام می‌شود و برای
 *     نام کاربری (که رمزنگاری‌شده است) فقط تطبیق دقیق پس از رمزگشایی.
 */
import { db, transaction } from './db.js';
import { decryptSecret, encryptSecret, tryDecryptSecret } from './credential-crypto.js';
import { assessSecret, STRENGTH_LABELS } from './credential-strength.js';
import { isBreachedSecret } from './credential-breach.js';

export const CREDENTIAL_KINDS = Object.freeze([
  { id: 'ssh', label: 'SSH' },
  { id: 'https', label: 'پنل وب (HTTPS)' },
  { id: 'telnet', label: 'Telnet' },
  { id: 'snmp', label: 'SNMP' },
  { id: 'console', label: 'کنسول / سریال' },
  { id: 'wifi', label: 'Wi‑Fi' },
  { id: 'api', label: 'API / توکن' },
  { id: 'database', label: 'پایگاه‌داده' },
  { id: 'mail', label: 'ایمیل' },
  { id: 'other', label: 'سایر' },
]);

const KIND_IDS = new Set(CREDENTIAL_KINDS.map((k) => k.id));
const KIND_MAP = new Map(CREDENTIAL_KINDS.map((k) => [k.id, k.label]));

const SORTS = {
  updated: 'c.updated_at DESC',
  label: 'c.label COLLATE NOCASE ASC',
  strength: 'c.strength ASC, c.updated_at DESC',
  due: 'COALESCE(c.last_rotated_at, c.created_at) ASC',
};

const MAX_SECRET = 1024;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** AAD هر ردیف: شناسه پس از درج مشخص می‌شود. */
function aadFor(id) {
  return `cred:${Number(id)}`;
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);

/** برچسب‌ها به شکل «a, b» ذخیره می‌شوند تا جست‌وجوی LIKE ساده و قابل ایندکس بماند. */
export function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[،,]/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const tag = text(item, 32).replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 12) break;
  }
  return out.join(', ');
}

function tagsOf(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function deviceExists(id) {
  return Boolean(db.prepare('SELECT 1 AS ok FROM devices WHERE id = ?').get(id));
}

/**
 * نرمال‌سازی و مرزگذاری ورودی. رمز فقط به‌صورت `secret` پذیرفته می‌شود و
 * فیلدهای رمزشدهٔ داخلی هرگز از بدنهٔ درخواست خوانده نمی‌شوند.
 */
export function sanitizeCredentialInput(input = {}, { partial = false } = {}) {
  const body = input ?? {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const out = {};
  const must = (key) => !partial || has(key);

  if (must('label')) {
    const label = text(body.label, 120);
    if (!label) throw httpError(400, 'عنوان رمز عبور الزامی است.');
    out.label = label;
  }
  if (must('kind')) {
    const kind = text(body.kind, 24).toLowerCase() || 'other';
    if (!KIND_IDS.has(kind)) throw httpError(400, 'نوع رمز عبور معتبر نیست.');
    out.kind = kind;
  }
  if (has('deviceId')) {
    if (body.deviceId === null || body.deviceId === '' || body.deviceId === undefined) {
      out.deviceId = null;
    } else {
      const id = Number(body.deviceId);
      if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'شناسهٔ تجهیز معتبر نیست.');
      if (!deviceExists(id)) throw httpError(400, 'تجهیز انتخاب‌شده یافت نشد.');
      out.deviceId = id;
    }
  }
  if (has('host')) out.host = text(body.host, 255);
  if (has('port')) {
    if (body.port === null || body.port === '' || body.port === undefined) out.port = null;
    else {
      const port = Number(body.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw httpError(400, 'پورت باید عددی بین ۱ و ۶۵۵۳۵ باشد.');
      out.port = port;
    }
  }
  if (has('tags')) out.tags = normalizeTags(body.tags);
  if (has('username')) out.username = text(body.username, 255);
  if (has('notes')) out.notes = text(body.notes, 2000);
  if (has('rotateEveryDays')) {
    if (body.rotateEveryDays === null || body.rotateEveryDays === '' || body.rotateEveryDays === undefined) {
      out.rotateEveryDays = null;
    } else {
      const days = Number(body.rotateEveryDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw httpError(400, 'دورهٔ چرخش باید بین ۱ و ۳۶۵۰ روز باشد.');
      }
      out.rotateEveryDays = days;
    }
  }
  if (has('secret') && body.secret !== null && body.secret !== undefined) {
    const secret = String(body.secret);
    if (secret.length > MAX_SECRET) throw httpError(400, `رمز نباید بیش از ${MAX_SECRET} نویسه باشد.`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(secret)) {
      throw httpError(400, 'رمز نباید نویسهٔ کنترلی داشته باشد.');
    }
    out.secret = secret;
  }
  if (!partial && !out.secret) throw httpError(400, 'رمز عبور الزامی است.');
  return out;
}

function parseReasons(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 4) : [];
  } catch {
    return [];
  }
}

function dueAt(row) {
  if (!row.rotate_every_days) return null;
  const base = row.last_rotated_at || row.created_at;
  return base + row.rotate_every_days * 86400000;
}

/** ردیف پایگاه‌داده → شکل API (بدون رمز). */
function serialize(row, { withNotes = false } = {}) {
  const due = dueAt(row);
  const reasons = parseReasons(row.weak_reasons);
  return {
    id: row.id,
    deviceId: row.device_id ?? null,
    deviceName: row.device_name ?? null,
    deviceIp: row.device_ip ?? null,
    label: row.label,
    kind: row.kind,
    kindLabel: KIND_MAP.get(row.kind) ?? KIND_MAP.get('other'),
    username: row.username_enc ? tryDecryptSecret(row.username_enc, aadFor(row.id)) : '',
    host: row.host || '',
    port: row.port ?? null,
    tags: tagsOf(row.tags),
    strength: Number(row.strength) || 0,
    strengthLabel: STRENGTH_LABELS[Number(row.strength) || 0],
    weak: (Number(row.strength) || 0) <= 1,
    weakReasons: reasons,
    hasSecret: Boolean(row.secret_enc),
    due: due != null ? due <= Date.now() : false,
    dueAt: due,
    lastRotatedAt: row.last_rotated_at ?? null,
    rotateEveryDays: row.rotate_every_days ?? null,
    createdBy: row.created_by || '',
    updatedBy: row.updated_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(withNotes ? { notes: row.notes_enc ? tryDecryptSecret(row.notes_enc, aadFor(row.id)) : '' } : {}),
  };
}

const SELECT_ROW = `
  SELECT c.*, d.name AS device_name, d.ip AS device_ip
  FROM credentials c
  LEFT JOIN devices d ON d.id = c.device_id
`;

/**
 * شناسه‌هایی که نام کاربری رمزگشایی‌شده‌شان با عبارت جست‌وجو می‌خواند.
 * نام کاربری رمزنگاری‌شده است، پس نمی‌توان با LIKE در SQL جست. حجم ردیف‌ها
 * برای یک مخزن تجهیزات کوچک است و این پیمایش فقط هنگام وجود عبارت جست‌وجو
 * اجرا می‌شود (با سقف ۵۰۰۰ ردیف).
 */
function usernameMatchIds(needle) {
  const rows = db.prepare('SELECT id, username_enc FROM credentials LIMIT 5000').all();
  const ids = [];
  for (const row of rows) {
    if (!row.username_enc) continue;
    const username = tryDecryptSecret(row.username_enc, aadFor(row.id)).toLowerCase();
    if (username && username.includes(needle)) ids.push(row.id);
  }
  return ids;
}

/** جست‌وجو، فیلتر، مرتب‌سازی و صفحه‌بندی فهرست مخزن. */
export function listCredentials(filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
  const search = String(filters.search ?? '').trim().slice(0, 80);
  const where = [];
  const params = [];

  if (filters.deviceId) {
    where.push('c.device_id = ?');
    params.push(Number(filters.deviceId));
  }
  if (filters.kind) {
    where.push('c.kind = ?');
    params.push(String(filters.kind).slice(0, 24));
  }
  if (filters.weak === true || filters.weak === '1' || filters.weak === 'true') {
    where.push('c.strength <= 1');
  }
  if (filters.due === true || filters.due === '1' || filters.due === 'true') {
    where.push('c.rotate_every_days IS NOT NULL AND COALESCE(c.last_rotated_at, c.created_at) + c.rotate_every_days * 86400000 <= ?');
    params.push(Date.now());
  }
  if (search) {
    const like = `%${search}%`;
    const ids = usernameMatchIds(search.toLowerCase());
    const idClause = ids.length ? ` OR c.id IN (${ids.map(() => '?').join(',')})` : '';
    where.push(
      `(c.label LIKE ? OR c.host LIKE ? OR c.tags LIKE ? OR c.kind LIKE ? OR d.name LIKE ? OR d.ip LIKE ?${idClause})`
    );
    params.push(like, like, like, like, like, like, ...ids);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = SORTS[String(filters.sort)] || SORTS.updated;
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM credentials c LEFT JOIN devices d ON d.id = c.device_id ${clause}`)
    .get(...params).c;
  const items = db
    .prepare(`${SELECT_ROW} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)
    .map((row) => serialize(row));

  return {
    items,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    search,
    kindLabels: CREDENTIAL_KINDS,
  };
}

/** شمارش خلاصه برای کارت‌های بالای صفحه و نشانگر ضعف. */
export function credentialSummary() {
  const now = Date.now();
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN strength <= 1 THEN 1 ELSE 0 END) AS weak,
         SUM(CASE WHEN strength = 0 THEN 1 ELSE 0 END) AS critical,
         SUM(CASE WHEN device_id IS NULL THEN 1 ELSE 0 END) AS detached,
         SUM(CASE WHEN rotate_every_days IS NOT NULL
                   AND COALESCE(last_rotated_at, created_at) + rotate_every_days * 86400000 <= ? THEN 1 ELSE 0 END) AS due,
         AVG(strength) AS avg_strength
       FROM credentials`
    )
    .get(now);
  const kinds = db
    .prepare('SELECT kind, COUNT(*) AS count FROM credentials GROUP BY kind ORDER BY count DESC')
    .all()
    .map((item) => ({ kind: item.kind, label: KIND_MAP.get(item.kind) ?? KIND_MAP.get('other'), count: item.count }));
  return {
    total: row.total || 0,
    weak: row.weak || 0,
    critical: row.critical || 0,
    detached: row.detached || 0,
    due: row.due || 0,
    avgStrength: row.avg_strength ? Math.round(Number(row.avg_strength) * 10) / 10 : 0,
    kinds,
  };
}

/** متادیتای یک ردیف (+ یادداشت رمزگشایی‌شده) */
export function getCredential(id, { withNotes = true } = {}) {
  const row = db.prepare(`${SELECT_ROW} WHERE c.id = ?`).get(Number(id));
  return row ? serialize(row, { withNotes }) : null;
}

/** رمز خام فقط برای مسیر صریح reveal؛ خطای کلید/داده به بالا می‌رود. */
export function revealCredential(id) {
  const row = db.prepare('SELECT id, label, username_enc, secret_enc FROM credentials WHERE id = ?').get(Number(id));
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    username: row.username_enc ? decryptSecret(row.username_enc, aadFor(row.id)) : '',
    secret: row.secret_enc ? decryptSecret(row.secret_enc, aadFor(row.id)) : '',
  };
}

function insertRow(data, actor) {
  const now = Date.now();
  const strength = assessSecret(data.secret, {
    label: data.label,
    username: data.username,
    host: data.host,
  });
  return transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO credentials(label, kind, device_id, host, port, tags, strength, weak_reasons, rotate_every_days, created_by, updated_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        data.label,
        data.kind ?? 'other',
        data.deviceId ?? null,
        data.host ?? '',
        data.port ?? null,
        data.tags ?? '',
        strength.score,
        JSON.stringify(strength.reasons),
        data.rotateEveryDays ?? null,
        String(actor ?? '').slice(0, 64),
        String(actor ?? '').slice(0, 64),
        now,
        now
      );
    const id = Number(info.lastInsertRowid);
    db.prepare('UPDATE credentials SET username_enc = ?, secret_enc = ?, notes_enc = ? WHERE id = ?').run(
      data.username ? encryptSecret(data.username, aadFor(id)) : '',
      encryptSecret(data.secret, aadFor(id)),
      data.notes ? encryptSecret(data.notes, aadFor(id)) : '',
      id
    );
    return id;
  });
}

export function createCredential(input, actor = '') {
  const data = sanitizeCredentialInput(input);
  const id = insertRow(data, actor);
  return getCredential(id);
}

export function updateCredential(id, input, actor = '') {
  const numeric = Number(id);
  const existing = db.prepare('SELECT * FROM credentials WHERE id = ?').get(numeric);
  if (!existing) return null;
  const data = sanitizeCredentialInput(input, { partial: true });
  const now = Date.now();

  const sets = [];
  const params = [];
  const assign = (column, value) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (data.label !== undefined) assign('label', data.label);
  if (data.kind !== undefined) assign('kind', data.kind);
  if (data.deviceId !== undefined) assign('device_id', data.deviceId);
  if (data.host !== undefined) assign('host', data.host);
  if (data.port !== undefined) assign('port', data.port);
  if (data.tags !== undefined) assign('tags', data.tags);
  if (data.rotateEveryDays !== undefined) assign('rotate_every_days', data.rotateEveryDays);
  if (data.notes !== undefined) assign('notes_enc', data.notes ? encryptSecret(data.notes, aadFor(numeric)) : '');

  // ارزیابی قدرت با مقدار نهایی (پس از اعمال تغییرات همین درخواست)
  const nextSecret =
    data.secret !== undefined ? data.secret : existing.secret_enc ? tryDecryptSecret(existing.secret_enc, aadFor(numeric)) : '';
  const nextLabel = data.label !== undefined ? data.label : existing.label;
  const nextHost = data.host !== undefined ? data.host : existing.host;
  const nextUsername =
    data.username !== undefined
      ? data.username
      : existing.username_enc
        ? tryDecryptSecret(existing.username_enc, aadFor(numeric))
        : '';
  const strength = assessSecret(nextSecret, { label: nextLabel, username: nextUsername, host: nextHost });
  assign('strength', strength.score);
  assign('weak_reasons', JSON.stringify(strength.reasons));

  if (data.username !== undefined) assign('username_enc', data.username ? encryptSecret(data.username, aadFor(numeric)) : '');
  if (data.secret !== undefined) {
    assign('secret_enc', data.secret ? encryptSecret(data.secret, aadFor(numeric)) : '');
    // تغییر رمز یعنی چرخش انجام شده است.
    assign('last_rotated_at', now);
  }
  assign('updated_by', String(actor ?? '').slice(0, 64));
  assign('updated_at', now);

  db.prepare(`UPDATE credentials SET ${sets.join(', ')} WHERE id = ?`).run(...params, numeric);
  return getCredential(numeric);
}

export function deleteCredential(id) {
  const info = db.prepare('DELETE FROM credentials WHERE id = ?').run(Number(id));
  return Number(info.changes) > 0;
}

/** ثبت «چرخش انجام شد» بدون تغییر خود رمز (مثلاً رمز روی تجهیز عوض شد). */
export function markRotated(id, { rotateEveryDays } = {}) {
  const numeric = Number(id);
  const existing = db.prepare('SELECT id FROM credentials WHERE id = ?').get(numeric);
  if (!existing) return null;
  const now = Date.now();
  if (rotateEveryDays === undefined) {
    db.prepare('UPDATE credentials SET last_rotated_at = ?, updated_at = ? WHERE id = ?').run(now, now, numeric);
  } else {
    const days = rotateEveryDays === null ? null : Number(rotateEveryDays);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
      throw httpError(400, 'دورهٔ چرخش باید بین ۱ و ۳۶۵۰ روز باشد.');
    }
    db.prepare('UPDATE credentials SET last_rotated_at = ?, rotate_every_days = ?, updated_at = ? WHERE id = ?').run(
      now,
      days,
      now,
      numeric
    );
  }
  return getCredential(numeric);
}

/**
 * بازمحاسبهٔ امتیاز همهٔ ردیف‌ها (پس از تغییر سیاست یا اصلاح داده).
 * ردیف‌هایی که کلیدشان قابل خواندن نیست نادیده گرفته می‌شوند و در خروجی
 * `unreadable` شمرده می‌شوند؛ این کار خطای یک ردیف را به کل عملیات سرایت نمی‌دهد.
 */
export function recheckStrengths() {
  const rows = db.prepare('SELECT id, label, host, username_enc, secret_enc, strength, weak_reasons FROM credentials').all();
  let updated = 0;
  let weak = 0;
  let unreadable = 0;
  const stmt = db.prepare('UPDATE credentials SET strength = ?, weak_reasons = ? WHERE id = ?');
  transaction(() => {
    for (const row of rows) {
      let secret;
      try {
        secret = row.secret_enc ? decryptSecret(row.secret_enc, aadFor(row.id)) : '';
      } catch {
        unreadable += 1;
        continue;
      }
      const username = row.username_enc ? tryDecryptSecret(row.username_enc, aadFor(row.id)) : '';
      const result = assessSecret(secret, { label: row.label, username, host: row.host });
      if (result.score <= 1) weak += 1;
      const reasons = JSON.stringify(result.reasons);
      if (result.score !== row.strength || reasons !== row.weak_reasons) {
        stmt.run(result.score, reasons, row.id);
        updated += 1;
      }
    }
  });
  return { checked: rows.length, updated, weak, unreadable };
}

/**
 * انتقال یک‌بارهٔ نام کاربری/رمز فعلی تجهیزات به مخزن.
 * idempotent است: برای هر تجهیزی که از قبل هر ردیفی در خزانه دارد (مثلاً هنگام
 * ذخیرهٔ اعتبارنامه در جزئیات تجهیز) ردیف تازه ساخته نمی‌شود. ستون‌های قدیمی
 * تجهیز دست‌نخورده می‌مانند.
 */
export function importDeviceCredentials(actor = '') {
  const MARK = 'دسترسی تجهیز';
  const devices = db
    .prepare(
      `SELECT id, name, access_username_enc, access_password_enc FROM devices
       WHERE COALESCE(access_username_enc, '') <> '' OR COALESCE(access_password_enc, '') <> ''`
    )
    .all();
  let created = 0;
  let skipped = 0;
  transaction(() => {
    for (const device of devices) {
      const exists = db.prepare('SELECT 1 AS ok FROM credentials WHERE device_id = ?').get(device.id);
      if (exists) {
        skipped += 1;
        continue;
      }
      const username = device.access_username_enc ? tryDecryptSecret(device.access_username_enc) : '';
      const secret = device.access_password_enc ? tryDecryptSecret(device.access_password_enc) : '';
      if (!username && !secret) {
        skipped += 1;
        continue;
      }
      const strength = assessSecret(secret, { label: MARK, username, host: '' });
      const now = Date.now();
      const info = db
        .prepare(
          `INSERT INTO credentials(label, kind, device_id, host, port, tags, strength, weak_reasons, created_by, updated_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          MARK,
          'other',
          device.id,
          '',
          null,
          '',
          strength.score,
          JSON.stringify(strength.reasons),
          String(actor ?? '').slice(0, 64),
          String(actor ?? '').slice(0, 64),
          now,
          now
        );
      const id = Number(info.lastInsertRowid);
      db.prepare('UPDATE credentials SET username_enc = ?, secret_enc = ? WHERE id = ?').run(
        username ? encryptSecret(username, aadFor(id)) : '',
        secret ? encryptSecret(secret, aadFor(id)) : '',
        id
      );
      created += 1;
    }
  });
  return { created, skipped, devices: devices.length };
}

/**
 * همگام‌سازی نام کاربری/رمز تب «دسترسی تجهیز» با خزانهٔ رمز عبور.
 *
 * بدون این تابع، رمزی که در جزئیات تجهیز ذخیره می‌شد در خزانه دیده نمی‌شد و
 * کاربر باید آن را دوباره وارد می‌کرد. اکنون هر ذخیرهٔ موفق تجهیز، ردیف متناظر
 * خزانه را می‌سازد یا به‌روزرسانی می‌کند.
 *
 * • اگر ردیفی با نشانگر «دسترسی تجهیز» یا هر ردیف دیگری متصل به همین تجهیز
 *   باشد، همان به‌روزرسانی می‌شود تا برای یک تجهیز دو ورودی ساخته نشود.
 * • بدون رمز، ردیف تازه ساخته نمی‌شود (خزانه ورودِ بدون رمز نمی‌پذیرد)؛ ولی
 *   نام کاربری ردیف موجود به‌روز می‌شود.
 * • پاک‌کردن رمز تجهیز، رمز ردیف خزانه را هم خالی می‌کند و خود ردیف می‌ماند.
 */
const DEVICE_CREDENTIAL_LABEL = 'دسترسی تجهیز';

export function syncDeviceCredential(deviceId, { username, password, cleared = false } = {}, actor = '') {
  const numeric = Number(deviceId);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;

  const hasUsername = username !== undefined;
  const hasPassword = typeof password === 'string' && password !== '';
  if (!hasUsername && !hasPassword && !cleared) return null;

  const device = db.prepare('SELECT id, name FROM devices WHERE id = ?').get(numeric);
  if (!device) return null;

  const existing =
    db
      .prepare('SELECT id FROM credentials WHERE device_id = ? AND label = ? ORDER BY id LIMIT 1')
      .get(numeric, DEVICE_CREDENTIAL_LABEL) ??
    db.prepare('SELECT id FROM credentials WHERE device_id = ? ORDER BY id LIMIT 1').get(numeric);

  if (existing) {
    const patch = {};
    if (hasUsername) patch.username = String(username ?? '').slice(0, 255);
    if (hasPassword) patch.secret = password;
    if (cleared) patch.secret = '';
    if (!Object.keys(patch).length) return null;
    return updateCredential(existing.id, patch, actor);
  }

  // ساخت ردیف تازه فقط وقتی رمز واقعی وجود دارد؛ ورود بدون رمز در خزانه
  // معنا ندارد و بررسی امنیت را هم مخدوش می‌کند.
  if (!hasPassword) return null;
  const label = device.name ? `دسترسی ${String(device.name).slice(0, 100)}` : DEVICE_CREDENTIAL_LABEL;
  return createCredential(
    {
      label,
      kind: 'other',
      deviceId: numeric,
      username: hasUsername ? String(username ?? '').slice(0, 255) : '',
      secret: password,
    },
    actor
  );
}

/* ================== بررسی امنیت، یکتایی و ورود/خروجی ================== */

/** نگاشت نام‌های فارسی/انگلیسی نوع دسترسی به شناسهٔ داخلی */
const KIND_IMPORT = new Map();
for (const item of CREDENTIAL_KINDS) {
  KIND_IMPORT.set(item.id.toLowerCase(), item.id);
  KIND_IMPORT.set(item.label.toLowerCase().replace(/\u200c/g, ' '), item.id);
}
for (const [alias, id] of [
  ['web', 'https'],
  ['website', 'https'],
  ['http', 'https'],
  ['پنل وب', 'https'],
  ['وب', 'https'],
  ['db', 'database'],
  ['token', 'api'],
  ['email', 'mail'],
  ['ایمیل', 'mail'],
  ['wifi', 'wifi'],
  ['wi-fi', 'wifi'],
  ['وای فای', 'wifi'],
  ['serial', 'console'],
  ['کنسول', 'console'],
  ['سایر', 'other'],
]) {
  KIND_IMPORT.set(alias, id);
}

function importKind(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\u200c/g, ' ');
  return KIND_IMPORT.get(key) ?? 'other';
}

/** رمز یک ردیف؛ ردیف ناخوانا استثنا می‌دهد تا در شمارش «unreadable» بیاید. */
function decryptRowSecret(row) {
  return row.secret_enc ? decryptSecret(row.secret_enc, aadFor(row.id)) : '';
}

/**
 * مجموعهٔ همهٔ رمزهای موجود (برای تضمین یکتایی رمز تولیدشده).
 * ردیف‌های ناخوانا نادیده گرفته می‌شوند و کل عملیات را خراب نمی‌کنند.
 */
export function existingSecrets() {
  const out = new Set();
  const rows = db.prepare("SELECT id, secret_enc FROM credentials WHERE secret_enc <> ''").all();
  for (const row of rows) {
    try {
      out.add(decryptRowSecret(row));
    } catch {
      /* کلید/دادهٔ ناخوانا: از مجموعه کنار گذاشته می‌شود */
    }
  }
  return out;
}

/**
 * «بررسی امنیت رمزها» بدون بازگرداندن هیچ رمزی.
 *
 * سه ایراد سنجیده می‌شود:
 *   • ضعیف: امتیاز ذخیره‌شده ۰ یا ۱ باشد (کوتاه/پیش‌فرض/قابل حدس)
 *   • تکراری: همان رمز برای بیش از یک ورودی استفاده شده باشد
 *   • افشاشده: رمز در فهرست مرجع محلی رمزهای لو‌رفته/پیش‌فرض باشد
 * خروجی فقط شناسه، عنوان و پرچم ایرادهاست؛ نه نام کاربری و نه رمز.
 */
export function checkupCredentials() {
  const rows = db
    .prepare(
      `SELECT c.id, c.label, c.kind, c.strength, c.weak_reasons, c.secret_enc, d.name AS device_name
       FROM credentials c LEFT JOIN devices d ON d.id = c.device_id
       ORDER BY c.label COLLATE NOCASE ASC`
    )
    .all();

  const scanned = [];
  const bySecret = new Map();
  for (const row of rows) {
    let secret = '';
    let readable = true;
    try {
      secret = decryptRowSecret(row);
    } catch {
      readable = false;
    }
    if (readable && secret) {
      const list = bySecret.get(secret) ?? [];
      list.push(row.id);
      bySecret.set(secret, list);
    }
    scanned.push({ row, secret, readable });
  }

  let weak = 0;
  let reused = 0;
  let breached = 0;
  let secure = 0;
  let unreadable = 0;
  const items = [];

  for (const entry of scanned) {
    if (!entry.readable) {
      unreadable += 1;
      continue;
    }
    const { row, secret } = entry;
    const score = Number(row.strength) || 0;
    const isWeak = score <= 1;
    const sharedWith = secret ? bySecret.get(secret)?.length ?? 0 : 0;
    const isReused = sharedWith > 1;
    const isBreached = secret ? isBreachedSecret(secret) : false;

    if (!isWeak && !isReused && !isBreached) {
      secure += 1;
      continue;
    }
    if (isWeak) weak += 1;
    if (isReused) reused += 1;
    if (isBreached) breached += 1;

    const issues = [];
    if (isBreached) issues.push('breached');
    if (isReused) issues.push('reused');
    if (isWeak) issues.push('weak');

    items.push({
      id: row.id,
      label: row.label,
      kind: row.kind,
      kindLabel: KIND_MAP.get(row.kind) ?? KIND_MAP.get('other'),
      deviceName: row.device_name ?? null,
      strength: score,
      strengthLabel: STRENGTH_LABELS[score] ?? STRENGTH_LABELS[0],
      weakReasons: parseReasons(row.weak_reasons),
      issues,
      sharedWith,
    });
  }

  // پرخطرترین‌ها اول: افشاشده، سپس تکراری، سپس ضعیف
  const weight = { breached: 3, reused: 2, weak: 1 };
  items.sort((a, b) => {
    const wa = Math.max(...a.issues.map((issue) => weight[issue] ?? 0));
    const wb = Math.max(...b.issues.map((issue) => weight[issue] ?? 0));
    if (wa !== wb) return wb - wa;
    return String(a.label).localeCompare(String(b.label), 'fa');
  });

  return {
    checked: rows.length,
    weak,
    reused,
    breached,
    secure,
    unreadable,
    issues: items.length,
    items,
    generatedAt: Date.now(),
  };
}

/** ردیف‌های قابل نوشتن در فایل Excel؛ فقط از مسیر مجاز خروجی صدا زده می‌شود. */
export function credentialExportRows() {
  const rows = db.prepare(`${SELECT_ROW} ORDER BY c.label COLLATE NOCASE ASC`).all();
  return rows.map((row) => ({
    label: row.label,
    username: tryDecryptSecret(row.username_enc, aadFor(row.id)),
    secret: tryDecryptSecret(row.secret_enc, aadFor(row.id)),
    host: row.host || '',
    port: row.port ?? '',
    device: row.device_name ?? '',
    kind: KIND_MAP.get(row.kind) ?? '',
    tags: tagsOf(row.tags).join('، '),
    notes: tryDecryptSecret(row.notes_enc, aadFor(row.id)),
  }));
}

/**
 * ورود گروهی رمزها از فایل Excel/CSV.
 *
 * هر ردیف مستقل ثبت می‌شود تا یک ردیف خراب کل فایل را از کار نیندازد؛
 * ردیف‌هایی که عنوانشان از قبل وجود دارد نادیده گرفته می‌شوند (idempotent).
 * خطاها بدون رمز و فقط با شمارهٔ ردیف برمی‌گردند.
 */
export function importCredentials(rows, actor = '') {
  const list = Array.isArray(rows) ? rows : [];
  const existingLabels = new Set(
    db
      .prepare('SELECT label FROM credentials')
      .all()
      .map((row) => String(row.label ?? '').trim().toLowerCase())
  );
  const devices = db.prepare('SELECT id, name, ip FROM devices').all();
  const deviceByIdentity = new Map();
  for (const device of devices) {
    deviceByIdentity.set(String(device.name ?? '').trim().toLowerCase(), device.id);
    deviceByIdentity.set(String(device.ip ?? '').trim().toLowerCase(), device.id);
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const row of list) {
    const label = String(row.label ?? '').trim().slice(0, 120);
    const secret = String(row.secret ?? '');
    const username = String(row.username ?? '').trim().slice(0, 255);
    const issues = [];

    if (!label) issues.push('عنوان وارد نشده است');
    if (!secret) issues.push('رمز عبور وارد نشده است');

    if (label) {
      const key = label.toLowerCase();
      if (existingLabels.has(key)) {
        skipped += 1;
        continue;
      }
    }

    const portRaw = String(row.port ?? '').trim();
    let port = null;
    if (portRaw) {
      port = Number(portRaw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        issues.push('پورت باید بین ۱ و ۶۵۵۳۵ باشد');
      }
    }

    if (issues.length) {
      failed += 1;
      if (errors.length < 50) errors.push({ row: Number(row.__row) || null, label, issues });
      continue;
    }

    const deviceRaw = String(row.device ?? '').trim();
    const deviceId =
      deviceRaw && /^\d+$/.test(deviceRaw)
        ? Number(deviceRaw)
        : deviceRaw
          ? deviceByIdentity.get(deviceRaw.toLowerCase()) ?? null
          : null;

    try {
      createCredential(
        {
          label,
          kind: importKind(row.kind),
          username,
          secret,
          host: String(row.host ?? '').trim().slice(0, 255),
          port,
          tags: String(row.tags ?? ''),
          notes: String(row.notes ?? '').slice(0, 2000),
          deviceId,
        },
        actor
      );
      created += 1;
      existingLabels.add(label.toLowerCase());
    } catch (e) {
      failed += 1;
      if (errors.length < 50) {
        errors.push({ row: Number(row.__row) || null, label, issues: [String(e?.message ?? 'ثبت ردیف ممکن نشد.')] });
      }
    }
  }

  return { total: list.length, created, skipped, failed, errors };
}

