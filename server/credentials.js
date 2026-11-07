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
    if (!label) throw httpError(400, 'عنوان اعتبارنامه الزامی است.');
    out.label = label;
  }
  if (must('kind')) {
    const kind = text(body.kind, 24).toLowerCase() || 'other';
    if (!KIND_IDS.has(kind)) throw httpError(400, 'نوع اعتبارنامه معتبر نیست.');
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
  if (!partial && !out.secret) throw httpError(400, 'رمز اعتبارنامه الزامی است.');
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
 * idempotent است: برای هر تجهیز فقط اگر اعتبارنامه‌ای با نشانگر «دسترسی تجهیز»
 * وجود نداشته باشد ساخته می‌شود. ستون‌های قدیمی تجهیز دست‌نخورده می‌مانند.
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
      const exists = db
        .prepare('SELECT 1 AS ok FROM credentials WHERE device_id = ? AND label = ?')
        .get(device.id, MARK);
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

