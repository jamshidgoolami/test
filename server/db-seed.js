/**
 * NetWatch — دادهٔ نمایشی اولیه (فقط با فعال‌سازی صریح).
 */
import { assertSqlIdentifier } from './db-safety.js';

export function createSeed({ db, transaction, STATUS }) {
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_GROUPS = [
  ['هسته شبکه', 'روترها و سوئیچ‌های مرکزی', '#2563eb'],
  ['سوئیچ‌های دسترسی', 'سوئیچ‌های لایه دسترسی ساختمان‌ها', '#0ea5e9'],
  ['فایروال و امنیت', 'تجهیزات امنیتی و VPN', '#7c3aed'],
  ['سرورها', 'سرورهای داخلی و مجازی', '#0d9488'],
  ['دوربین‌های نظارتی', 'NVR و دوربین‌های IP', '#db2777'],
  ['بی‌سیم و آنتن', 'اکسس‌پوینت‌ها و لینک‌های بی‌سیم', '#f59e0b'],
  ['زیرساخت برق', 'UPS و تجهیزات برق شبکه', '#64748b'],
];

const SEED_TAGS = [
  ['حیاتی', '#dc2626', 1, 'shield-alert'],
  ['ستون فقرات', '#2563eb', 1, 'network'],
  ['نقطه لبه', '#f59e0b', 1, 'radio'],
  ['پشت UPS', '#64748b', 0, 'battery-charging'],
  ['دارای پشتیبان', '#16a34a', 0, 'git-branch'],
  ['لینک اینترنت', '#0891b2', 1, 'globe'],
  ['در حال تعویض', '#a855f7', 1, 'wrench'],
];

const TYPE_BY_GROUP = {
  'هسته شبکه': ['روتر', 'سوئیچ'],
  'سوئیچ‌های دسترسی': ['سوئیچ'],
  'فایروال و امنیت': ['فایروال'],
  سرورها: ['سرور'],
  'دوربین‌های نظارتی': ['دوربین IP'],
  'بی‌سیم و آنتن': ['اکسس‌پوینت'],
  'زیرساخت برق': ['UPS شبکه'],
};

const PLACES = [
  ['تهران — مرکز داده اصلی', 'ساختمان A — طبقه ۱', 35.7005, 51.338],
  ['تهران — ساختمان اداری', 'ساختمان B — طبقه ۳', 35.7289, 51.3896],
  ['تهران — انبار مرکزی', 'ساختمان C', 35.662, 51.31],
  ['کرج — شعبه غرب', 'طبقه ۲', 35.8355, 50.9915],
  ['اصفهان — شعبه مرکزی', 'طبقه ۱', 32.6546, 51.668],
  ['مشهد — شعبه شرق', 'طبقه ۴', 36.2972, 59.6067],
  ['شیراز — دیتاسنتر پشتیبان', 'سالن B', 29.5918, 52.5837],
  ['تبریز — شعبه شمال‌غرب', 'طبقه ۲', 38.0805, 46.2919],
  ['اهواز — مرکز عملیات', 'طبقه ۱', 31.3183, 48.6706],
  ['قم — سایت مخابراتی', 'سایت', 34.6399, 50.8759],
  ['رشت — شعبه شمال', 'طبقه ۳', 37.2808, 49.5832],
  ['بندرعباس — پست فنی', 'پست', 27.1832, 56.2666],
];

const CAUSES = [
  'قطعی برق',
  'هنگ کردن سوئیچ',
  'اختلال در زیرساخت فیبر نوری',
  'مشکل شبکه',
  'سوختن یا خرابی تجهیز',
  'بازیابی خودکار پس از قطعی',
  'به‌روزرسانی نرم‌افزار',
];
// فهرست اقدام‌های پیش‌فرض تعمیرات در DEFAULT_SETTINGS (repair_actions) نگهداری می‌شود.

function seedIfEmpty({ force = false } = {}) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM devices').get().c;
  if (count > 0 && !force) return false;

  const now = Date.now();
  const rnd = mulberry32(20261016);

  // اگر سرور و engine-cli هم‌زمان روی پایگاه‌دادهٔ تازه اجرا شوند، هر دو ممکن
  // است جدول را خالی ببینند و دادهٔ نمایشی را دوبار درج کنند (خطای UNIQUE روی
  // نام گروه). BEGIN IMMEDIATE نوشتن را از همان ابتدا قفل می‌کند و بررسی
  // دوبارهٔ داخل تراکنش، درج تکراری را ناممکن می‌کند.
  try {
    return transaction(
      () => {
    if (!force && db.prepare('SELECT COUNT(*) AS c FROM devices').get().c > 0) {
      return false;
    }
    if (force) {
      for (const t of [
        'alert_rules',
        'alerts',
        'maintenance_records',
        'maintenance_windows',
        'device_tags',
        'outages',
        'samples',
        'daily_stats',
        'devices',
        'groups',
        'tags',
        'map_markers',
        'marker_types',
        'map_layers',
        'engine_log',
      ]) {
        db.exec(`DELETE FROM ${assertSqlIdentifier(t, 'نام جدول')}`);
      }
    }

    // لایه‌های نقشه
    const layerStmt = db.prepare(
      'INSERT INTO map_layers(name, description, kind, file_name, min_zoom, max_zoom, attribution, visible, is_default, tile_count, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    );
    // شناسهٔ لایه به‌صورت پویا خوانده می‌شود؛ در بازنشانی داده‌ها (AUTOINCREMENT)
    // شناسه‌ها ادامه پیدا می‌کنند و یک مقدار ثابت به کلید بیرونی نامعتبر اشاره می‌کرد.
    const builtinLayerId = Number(
      layerStmt.run(
        'نقشه برداری پایه (آفلاین)',
        'لایه وکتور داخلی بدون نیاز به اینترنت',
        'builtin',
        null,
        3,
        18,
        'NetWatch',
        1,
        1,
        0,
        now
      ).lastInsertRowid
    );
    layerStmt.run('لایه شبکه — نقشه شهری', 'لایه نمونه؛ فایل .mbtiles خود را بارگذاری کنید', 'empty', null, 3, 18, '', 1, 0, 0, now);
    layerStmt.run('لایه زیرساخت ساختمان‌ها', 'لایه داخلی برای تجهیزات داخل ساختمان', 'empty', null, 5, 20, '', 0, 0, 0, now);

    const groups = new Map();
    const gStmt = db.prepare('INSERT INTO groups(name, description, color, created_at) VALUES (?,?,?,?)');
    for (const [name, desc, color] of SEED_GROUPS) {
      const res = gStmt.run(name, desc, color, now);
      groups.set(name, Number(res.lastInsertRowid));
    }

    const tags = new Map();
    const tStmt = db.prepare('INSERT INTO tags(name, color, show_on_map, icon, created_at) VALUES (?,?,?,?,?)');
    for (const [name, color, onMap, icon] of SEED_TAGS) {
      const res = tStmt.run(name, color, onMap, icon, now);
      tags.set(name, Number(res.lastInsertRowid));
    }

    // تولید تجهیزات
    const deviceStmt = db.prepare(`INSERT INTO devices
      (name, ip, hostname, device_type, group_id, location, building, rack, latitude, longitude, map_layer_id,
       vendor, model, serial, firmware, owner, notes, priority, enabled, monitoring_enabled, ping_interval,
       timeout_ms, packet_count, retries, latency_threshold, loss_threshold, status, uptime_pct, total_checks,
       created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    const vendors = ['Cisco', 'HPE Aruba', 'MikroTik', 'Huawei', 'Ubiquiti', 'TP-Link', 'Fortinet', 'Juniper'];
    const inserted = [];
    let seq = 0;

    for (const [groupName, groupId] of groups) {
      const types = TYPE_BY_GROUP[groupName];
      const howMany = groupName === 'سوئیچ‌های دسترسی' ? 14 : groupName === 'دوربین‌های نظارتی' ? 8 : 5;
      for (let i = 0; i < howMany; i++) {
        seq++;
        const place = PLACES[Math.floor(rnd() * PLACES.length)];
        const type = types[Math.floor(rnd() * types.length)];
        const vendor = vendors[Math.floor(rnd() * vendors.length)];
        const ip = `10.${10 + (seq % 4)}.${Math.floor(seq / 60) + 1}.${(seq % 250) + 2}`;
        const hasGeo = rnd() > 0.16;
        const lat = hasGeo ? place[2] + (rnd() - 0.5) * 0.035 : null;
        const lng = hasGeo ? place[3] + (rnd() - 0.5) * 0.05 : null;
        const disabled = rnd() > 0.94 ? 1 : 0;
        const priority = rnd() > 0.86 ? 'critical' : rnd() > 0.6 ? 'high' : rnd() > 0.25 ? 'normal' : 'low';
        const name = `${groupName.split(' ')[0]}-${String(seq).padStart(3, '0')} (${place[0].split('—')[0].trim()})`;

        const res = deviceStmt.run(
          name,
          ip,
          `${groupName.replace(/\s/g, '').toLowerCase()}-${seq}.local`,
          type,
          groupId,
          place[0],
          place[1],
          `R${Math.ceil(rnd() * 24)}-U${Math.ceil(rnd() * 40)}`,
          lat,
          lng,
          hasGeo ? builtinLayerId : null,
          vendor,
          `${vendor.split(' ')[0]}-${1000 + Math.ceil(rnd() * 8000)}`,
          `SN${Math.floor(rnd() * 1e9).toString(16).toUpperCase()}`,
          `${Math.ceil(rnd() * 9)}.${Math.ceil(rnd() * 9)}.${Math.ceil(rnd() * 9)}`,
          ['تیم شبکه', 'تیم زیرساخت', 'تیم امنیت'][Math.floor(rnd() * 3)],
          '',
          priority,
          disabled ? 0 : 1,
          disabled ? 0 : 1,
          rnd() > 0.7 ? [15, 30, 60, 120, 300][Math.floor(rnd() * 5)] : null,
          rnd() > 0.8 ? [800, 1000, 1500, 2000][Math.floor(rnd() * 4)] : null,
          rnd() > 0.8 ? [1, 3, 5][Math.floor(rnd() * 3)] : null,
          rnd() > 0.85 ? [0, 1, 2][Math.floor(rnd() * 3)] : null,
          rnd() > 0.85 ? [80, 120, 200][Math.floor(rnd() * 3)] : null,
          rnd() > 0.9 ? [5, 15, 25][Math.floor(rnd() * 3)] : null,
          disabled ? STATUS.UNKNOWN : STATUS.ONLINE,
          disabled ? 0 : 98 + rnd() * 2,
          0,
          now - Math.floor(rnd() * 200 * 86400000),
          now
        );
        const id = Number(res.lastInsertRowid);
        inserted.push({ id, group: groupName, type, ip, lat, lng, disabled, place });
      }
    }

    // تگ‌گذاری
    const attach = db.prepare('INSERT OR IGNORE INTO device_tags(device_id, tag_id) VALUES (?,?)');
    const tagNames = [...tags.keys()];
    for (const d of inserted) {
      const n = 1 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const t = tagNames[Math.floor(rnd() * tagNames.length)];
        attach.run(d.id, tags.get(t));
      }
      if (d.group === 'هسته شبکه') attach.run(d.id, tags.get('ستون فقرات'));
      if (d.type === 'فایروال') attach.run(d.id, tags.get('حیاتی'));
      if (d.group === 'بی‌سیم و آنتن') attach.run(d.id, tags.get('نقطه لبه'));
    }

    // پنجره تعمیرات پیش‌فرض (سراسری)
    db.prepare(
      'INSERT INTO maintenance_windows(device_id, title, days, start_time, end_time, enabled, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(null, 'پنجره تعمیرات شبانه', '0,1,2,3,4,5,6', '01:00', '03:00', 0, now);

    // انواع «علامت» روی نقشه و چند جانمایی نمونه
    const mtypeStmt = db.prepare('INSERT INTO marker_types(name, color, icon, description, created_at) VALUES (?,?,?,?,?)');
    const mtypeIds = {};
    for (const [mtName, mtColor, mtIcon, mtDesc] of [
      ['تجهیز در حال نصب', '#0ea5e9', 'hammer', 'تجهیزاتی که در حال نصب یا راه‌اندازی هستند'],
      ['نقطه بازدید دوره‌ای', '#16a34a', 'eye', 'نقاطی که نیاز به بازدید دوره‌ای دارند'],
      ['محل حادثه و خرابی', '#dc2626', 'triangle-alert', 'محل وقوع خرابی یا حادثه'],
      ['نقطه توسعه آینده', '#7c3aed', 'circle-plus', 'مکان‌های پیش‌بینی‌شده برای توسعه'],
    ]) {
      mtypeIds[mtName] = Number(mtypeStmt.run(mtName, mtColor, mtIcon, mtDesc, now).lastInsertRowid);
    }
    const markerStmt = db.prepare(
      'INSERT INTO map_markers(type_id, name, latitude, longitude, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    );
    for (const [mkType, mkName, mkLat, mkLng] of [
      ['تجهیز در حال نصب', 'نصب سوئیچ — ساختمان اداری', 35.7289, 51.3896],
      ['تجهیز در حال نصب', 'نصب اکسس‌پوینت — طبقه ۳', 35.7312, 51.4021],
      ['تجهیز در حال نصب', 'نصب دوربین — ورودی شرقی', 35.7021, 51.4243],
      ['تجهیز در حال نصب', 'نصب UPS — اتاق سرور', 35.7108, 51.3588],
      ['تجهیز در حال نصب', 'نصب لینک بی‌سیم — پشت‌بام', 35.6962, 51.4015],
      ['محل حادثه و خرابی', 'خرابی فیبر — مسیر شمالی', 35.7402, 51.3711],
      ['نقطه بازدید دوره‌ای', 'بازدید ماهانه — شعبه غرب', 35.8355, 50.9915],
    ]) {
      markerStmt.run(mtypeIds[mkType], mkName, mkLat, mkLng, '', now, now);
    }

    // قوانین هشدار پیش‌فرض
    const ruleStmt = db.prepare(
      'INSERT INTO alert_rules(name, enabled, metric, comparator, threshold, duration_sec, severity, scope_group_id, cooldown_sec, apply_to_unmon, silent, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    ruleStmt.run('قطع دسترسی تجهیز', 1, 'offline', 'gte', 1, 0, 'critical', null, 600, 1, 0, now);
    ruleStmt.run('تأخیر بیش از حد مجاز', 1, 'latency', 'gte', 150, 60, 'warning', null, 900, 0, 0, now);
    ruleStmt.run('افت شدید بسته (Packet Loss)', 1, 'loss', 'gte', 10, 0, 'warning', null, 600, 0, 0, now);
    ruleStmt.run('بازگشت تجهیز به وضعیت عادی', 1, 'recovery', 'lte', 1, 0, 'info', null, 0, 0, 0, now);
    ruleStmt.run('تأخیر بحرانی ستون فقرات', 1, 'latency', 'gte', 90, 120, 'critical', groups.get('هسته شبکه'), 1200, 0, 1, now);

    // ---------------- تولید تاریخچه ۷ روزه ----------------
    const HOURS = 24 * 7;
    const stepMs = 5 * 60 * 1000; // نمونه هر ۵ دقیقه
    const totalSlots = HOURS * 12;
    const startTs = Math.floor((now - HOURS * 3600000) / stepMs) * stepMs;

    const sampleStmt = db.prepare(
      'INSERT INTO samples(device_id, ts, rtt_ms, packets_sent, packets_recv, loss_pct, status, ok, mode) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    const outageStmt = db.prepare(
      'INSERT INTO outages(device_id, started_at, ended_at, duration_sec, cause, detail, lat, lng, open) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    const daily = new Map(); // key deviceId|day
    const bump = (deviceId, ts, ok, rtt, loss) => {
      const day = new Date(ts).toISOString().slice(0, 10);
      const key = `${deviceId}|${day}`;
      let row = daily.get(key);
      if (!row) {
        row = { deviceId, day, checks: 0, failed: 0, sum: 0, n: 0, max: 0, loss: 0, outages: 0, downtime: 0 };
        daily.set(key, row);
      }
      row.checks++;
      if (!ok) row.failed++;
      if (rtt != null) {
        row.sum += rtt;
        row.n++;
        row.max = Math.max(row.max, rtt);
      }
      row.loss += ok ? 0 : 100;
      return row;
    };

    const offlineNow = new Set();
    const warningNow = new Set();
    const outageCounters = new Map();

    const active = inserted.filter((d) => !d.disabled);
    // انتخاب تعدادی تجهیز برای وضعیت فعلی
    const shuffled = [...active].sort(() => rnd() - 0.5);
    const currentOffline = new Set(shuffled.slice(0, 4).map((d) => d.id));
    const currentWarning = new Set(shuffled.slice(4, 13).map((d) => d.id));

    for (const d of inserted) {
      if (d.disabled) continue;
      const baseLat = 3 + rnd() * 45;
      const jitter = 2 + rnd() * 18;
      const lossiness = rnd() > 0.78 ? 0.25 + rnd() * 0.5 : 0.02;
      const flapProne = rnd() > 0.7;

      // ساخت پنجره‌های قطعی تصادفی
      const windows = [];
      const nOut = flapProne ? 3 + Math.floor(rnd() * 4) : Math.floor(rnd() * 3);
      for (let i = 0; i < nOut; i++) {
        const startSlot = Math.floor(rnd() * (totalSlots - 20));
        const len = 1 + Math.floor(rnd() * (flapProne ? 9 : 4));
        windows.push([startSlot, startSlot + len]);
      }
      // قطعی جاری برای تجهیزات آفلاین
      if (currentOffline.has(d.id)) windows.push([totalSlots - 3, totalSlots + 1]);

      let prevStatus = STATUS.ONLINE;
      let openOutageId = null;

      for (let s = 0; s < totalSlots; s++) {
        const ts = startTs + s * stepMs;
        const inWindow = windows.find(([a, b]) => s >= a && s < b);
        let ok = true;
        let loss = 0;

        if (inWindow) {
          ok = false;
          loss = 100;
        } else if (rnd() < lossiness * 0.25) {
          loss = 30 + rnd() * 70;
          ok = rnd() > 0.5;
        }

        const rtt = ok ? Math.max(0.4, baseLat + (rnd() - 0.5) * jitter * 2 + (s % 288) * 0.004) : null;
        const status = ok ? (rtt > 150 ? STATUS.WARNING : STATUS.ONLINE) : STATUS.OFFLINE;
        // تاریخچهٔ دادهٔ نمایشی هم «شبیه‌سازی‌شده» است؛ با همین برچسب ثبت می‌شود
        // تا در UI/API از نمونه‌های واقعی (icmp/tcp) قابل تشخیص باشد.
        sampleStmt.run(d.id, ts, rtt == null ? null : Number(rtt.toFixed(2)), 3, ok ? (loss ? 2 : 3) : 0, Number(loss.toFixed(1)), status, ok ? 1 : 0, 'simulate');
        const row = bump(d.id, ts, ok, rtt, loss);

        if (status === STATUS.OFFLINE && prevStatus !== STATUS.OFFLINE) {
          const cause = CAUSES[Math.floor(rnd() * CAUSES.length)];
          const res = outageStmt.run(d.id, ts, null, null, cause, '', d.lat, d.lng, 1);
          openOutageId = Number(res.lastInsertRowid);
          row.outages++;
          outageCounters.set(d.id, (outageCounters.get(d.id) || 0) + 1);
        } else if (status !== STATUS.OFFLINE && prevStatus === STATUS.OFFLINE && openOutageId) {
          const dur = Math.max(60, Math.round((ts - (startTs + (inWindow ? inWindow[0] : s) * stepMs)) / 1000));
          db.prepare('UPDATE outages SET ended_at=?, duration_sec=?, open=0 WHERE id=?').run(ts, dur, openOutageId);
          const key = `${d.id}|${new Date(ts).toISOString().slice(0, 10)}`;
          const r2 = daily.get(key);
          if (r2) r2.downtime += dur;
          openOutageId = null;
        } else if (status === STATUS.OFFLINE && openOutageId) {
          const key = `${d.id}|${new Date(ts).toISOString().slice(0, 10)}`;
          const r2 = daily.get(key);
          if (r2) r2.downtime += stepMs / 1000;
        }
        prevStatus = status;
      }
      if (currentOffline.has(d.id)) offlineNow.add(d.id);
      else if (currentWarning.has(d.id) || baseLat > 90) warningNow.add(d.id);
    }

    // آمار روزانه
    const dailyStmt = db.prepare(
      'INSERT INTO daily_stats(device_id, day, checks, failed, avg_rtt, max_rtt, loss_pct, outages, downtime_sec, uptime_pct) VALUES (?,?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(device_id, day) DO UPDATE SET checks=excluded.checks, failed=excluded.failed, avg_rtt=excluded.avg_rtt, max_rtt=excluded.max_rtt, loss_pct=excluded.loss_pct, outages=excluded.outages, downtime_sec=excluded.downtime_sec, uptime_pct=excluded.uptime_pct'
    );
    for (const row of daily.values()) {
      const avg = row.n ? row.sum / row.n : null;
      const uptime = row.checks ? ((row.checks - row.failed) / row.checks) * 100 : null;
      dailyStmt.run(
        row.deviceId,
        row.day,
        row.checks,
        row.failed,
        avg == null ? null : Number(avg.toFixed(2)),
        Number(row.max.toFixed(2)),
        Number((row.loss / row.checks).toFixed(2)),
        row.outages,
        Math.round(row.downtime),
        uptime == null ? null : Number(uptime.toFixed(2))
      );
    }

    // یکسان‌سازی: تنها تجهیزات در حال قطعی حق دارند قطعی «باز» داشته باشند و حداکثر یکی
    const offlineIds = [...currentOffline];
    db.prepare(
      `UPDATE outages SET ended_at = started_at + 60000, duration_sec = 60, open = 0
       WHERE open = 1 AND device_id NOT IN (${offlineIds.length ? offlineIds.map(() => '?').join(',') : 'NULL'})`
    ).run(...offlineIds);
    for (const id of offlineIds) {
      db.prepare(
        `UPDATE outages SET ended_at = started_at + 60000, duration_sec = 60, open = 0
         WHERE device_id = ? AND open = 1 AND id != (SELECT id FROM outages WHERE device_id = ? AND open = 1 ORDER BY started_at DESC LIMIT 1)`
      ).run(id, id);
    }

    // وضعیت فعلی و شاخص‌های تجمیعی
    const aggStmt = db.prepare(`SELECT
        COUNT(*) AS checks,
        SUM(ok) AS ok_count,
        MIN(rtt_ms) AS min_rtt,
        MAX(rtt_ms) AS max_rtt,
        AVG(rtt_ms) AS avg_rtt,
        AVG(loss_pct) AS avg_loss,
        MAX(ts) AS last_ts
      FROM samples WHERE device_id = ?`);
    const lastSample = db.prepare(
      'SELECT rtt_ms, loss_pct, status, ts FROM samples WHERE device_id = ? ORDER BY ts DESC LIMIT 1'
    );
    const lastOutage = db.prepare('SELECT started_at FROM outages WHERE device_id = ? ORDER BY started_at DESC LIMIT 1');
    const openOutage = db.prepare('SELECT id, started_at FROM outages WHERE device_id = ? AND open = 1 ORDER BY started_at DESC LIMIT 1');
    const successCount = db.prepare('SELECT COUNT(*) AS c FROM samples WHERE device_id=? AND ok=1');
    const failCount = db.prepare('SELECT COUNT(*) AS c FROM samples WHERE device_id=? AND ok=0');

    for (const d of inserted) {
      if (d.disabled) continue;
      const a = aggStmt.get(d.id);
      const last = lastSample.get(d.id);
      const isOffline = currentOffline.has(d.id) || (last && last.status === STATUS.OFFLINE);
      const isWarning = !isOffline && (warningNow.has(d.id) || (last && last.status === STATUS.WARNING));
      const status = isOffline ? STATUS.OFFLINE : isWarning ? STATUS.WARNING : STATUS.ONLINE;
      const uptime = a.checks ? ((a.ok_count || 0) / a.checks) * 100 : 100;
      const oo = isOffline ? openOutage.get(d.id) : null;
      const lo = lastOutage.get(d.id);

      db.prepare(`UPDATE devices SET
          status=?, status_reason=?, last_check_at=?, last_status_change_at=?,
          last_rtt_ms=?, min_rtt_ms=?, max_rtt_ms=?, avg_rtt_ms=?, loss_pct=?,
          success_count=?, fail_count=?, total_checks=?,
          consecutive_failures=?, consecutive_successes=?,
          uptime_pct=?, last_outage_at=?, current_outage_id=?, current_outage_started_at=?
        WHERE id=?`).run(
        status,
        isOffline ? 'عدم پاسخ به Ping' : isWarning ? 'تأخیر یا افت بسته بیش از حد مجاز' : '',
        last ? last.ts : null,
        now - Math.floor(rnd() * 4 * 3600000),
        last ? last.rtt_ms : null,
        a.min_rtt ?? null,
        a.max_rtt ?? null,
        a.avg_rtt == null ? null : Number(a.avg_rtt.toFixed(2)),
        last ? last.loss_pct : 0,
        successCount.get(d.id).c,
        failCount.get(d.id).c,
        a.checks,
        isOffline ? 3 + Math.floor(rnd() * 12) : 0,
        isOffline ? 0 : 5 + Math.floor(rnd() * 60),
        Number(uptime.toFixed(2)),
        lo ? lo.started_at : null,
        oo ? oo.id : null,
        oo ? oo.started_at : null,
        d.id
      );
    }

    // سوابق تعمیرات به‌صورت خودکار ساخته نمی‌شوند؛ این بخش فقط شامل رکوردهایی است
    // که کاربر خودش ثبت می‌کند. بنابراین داده‌های نمونه هیچ سابقهٔ تعمیراتی ندارند.

    // هشدارهای نمونه
    const alertStmt = db.prepare(
      'INSERT INTO alerts(device_id, rule_id, severity, kind, title, message, value, created_at, status, acknowledged_at, acknowledged_by, resolved_at, notified, duplicate_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    const recentOutages = db.prepare(
      'SELECT o.id, o.device_id, o.started_at, o.ended_at, o.cause, d.name, d.ip FROM outages o JOIN devices d ON d.id=o.device_id ORDER BY o.started_at DESC LIMIT 40'
    ).all();
    recentOutages.forEach((o, idx) => {
      const sev = o.cause.includes('خرابی') || o.cause.includes('برق') ? 'critical' : 'warning';
      const status = idx < 3 ? 'active' : idx % 5 === 0 ? 'acknowledged' : 'resolved';
      alertStmt.run(
        o.device_id,
        null,
        sev,
        'offline',
        `قطع ارتباط — ${o.name}`,
        `تجهیز ${o.name} (${o.ip}) در ساعت ${new Date(o.started_at).toLocaleString('fa-IR')} پاسخ نداد. علت ثبت‌شده: ${o.cause}`,
        null,
        o.started_at,
        status,
        status !== 'active' ? o.started_at + 300000 : null,
        status !== 'active' ? 'مدیر شبکه' : null,
        o.ended_at || (status === 'resolved' ? o.started_at + 600000 : null),
        1,
        `offline:${o.device_id}:${o.started_at}`
      );
      if (o.ended_at) {
        alertStmt.run(
          o.device_id,
          null,
          'info',
          'recovery',
          `بازگشت به حالت عادی — ${o.name}`,
          `تجهیز ${o.name} مجدداً در دسترس قرار گرفت.`,
          null,
          o.ended_at,
          'resolved',
          null,
          null,
          o.ended_at,
          1,
          `recovery:${o.device_id}:${o.ended_at}`
        );
      }
    });

    db.prepare('INSERT INTO engine_log(ts, level, message) VALUES (?,?,?)').run(
      now,
      'info',
      'داده‌های نمونه اولیه بارگذاری شد (۷ روز تاریخچه).'
    );
        return true;
      },
      { immediate: true, label: 'seed' }
    );
  } catch (e) {
    // رقابت دو فرآیند روی پایگاه‌دادهٔ تازه: نمونهٔ دیگر زودتر نوشته است.
    if (/busy|locked/i.test(String(e.message))) return false;
    throw e;
  }
}


  return seedIfEmpty;
}
