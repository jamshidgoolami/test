/**
 * NetWatch — نرمال‌سازی دادهٔ Agent ویندوز
 * ----------------------------------------------------------------
 * Agent فقط دادهٔ خام و کوچک می‌فرستد؛ این ماژول آن را به قرارداد ذخیره‌سازی
 * تبدیل می‌کند. همهٔ متن‌ها/آرایه‌ها مرز دارند تا یک Agent ناقص یا خراب نتواند
 * پایگاه‌داده/حافظه را با دادهٔ بی‌پایان پر کند.
 */

export const AGENT_SCHEMA_VERSION = 1;
const MAX_DISKS = 128;
const MAX_NICS = 64;
const MAX_TEXT = 180;
const GIB = 1024 ** 3;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function number(value, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function integer(value, options) {
  const n = number(value, options);
  return n == null ? null : Math.round(n);
}

function text(value, max = MAX_TEXT) {
  if (value == null) return '';
  return String(value).trim().slice(0, max);
}

function health(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'ok' || v === 'healthy' || v === 'good' || v === 'normal') return 'ok';
  if (v === 'warning' || v === 'warn' || v === 'caution' || v === 'degraded') return 'warning';
  if (v === 'critical' || v === 'unhealthy' || v === 'failed' || v === 'error') return 'critical';
  return 'unknown';
}

const HEALTH_RANK = { unknown: 0, ok: 1, warning: 2, critical: 3 };
export function worstHealth(values) {
  let result = 'unknown';
  for (const value of values) {
    const h = health(value);
    if (HEALTH_RANK[h] > HEALTH_RANK[result]) result = h;
  }
  return result;
}

function collectedAt(value, now) {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) return now;
  // ساعت سرور و Agent ممکن است چند دقیقه اختلاف داشته باشند؛ اختلاف بیش از
  // ده دقیقه یعنی داده قابل‌اتکا نیست و زمان دریافت ثبت می‌شود.
  return Math.abs(parsed - now) <= 10 * 60 * 1000 ? Math.round(parsed) : now;
}

/**
 * @param {Record<string, unknown>} body
 * @param {number} [now]
 * @returns {{collectedAt:number, metric:object, disks:object[], nics:object[], inventory:object|null, raw:object}}
 */
export function normalizeAgentPayload(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('بدنهٔ Agent باید یک شیء JSON باشد.');
  }
  const version = Number(body.schemaVersion ?? AGENT_SCHEMA_VERSION);
  if (version !== AGENT_SCHEMA_VERSION) {
    throw new Error(`نسخهٔ Agent پشتیبانی نمی‌شود (${version}).`);
  }

  const cpu = body.cpu && typeof body.cpu === 'object' ? body.cpu : {};
  const memory = body.memory && typeof body.memory === 'object' ? body.memory : {};
  const inventory = body.inventory && typeof body.inventory === 'object' ? body.inventory : {};

  const cpuPct = number(cpu.usagePct, { min: 0, max: 100 });
  const memTotal = number(memory.totalBytes, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const memFree = number(memory.freeBytes, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const memUsed = memTotal != null && memFree != null ? Math.max(0, memTotal - Math.min(memFree, memTotal)) : null;
  const memPct = memTotal && memUsed != null ? clamp((memUsed / memTotal) * 100, 0, 100) : null;

  const seenDisks = new Set();
  const disks = (Array.isArray(body.disks) ? body.disks : [])
    .slice(0, MAX_DISKS)
    .map((raw, index) => {
      const d = raw && typeof raw === 'object' ? raw : {};
      const rawKey = text(d.key ?? d.id ?? d.mount ?? d.name ?? `disk-${index}`, 120);
      if (!rawKey) return null;
      const key = `agent:${rawKey}`.slice(0, 160);
      if (seenDisks.has(key)) return null;
      seenDisks.add(key);
      const total = number(d.totalBytes, { min: 0, max: Number.MAX_SAFE_INTEGER });
      const free = number(d.freeBytes, { min: 0, max: Number.MAX_SAFE_INTEGER });
      const usedPct = total && free != null ? clamp(((total - Math.min(free, total)) / total) * 100, 0, 100) : null;
      return {
        diskKey: key,
        source: 'agent',
        kind: d.kind === 'physical' ? 'physical' : 'volume',
        name: text(d.name ?? d.model ?? rawKey),
        mount: text(d.mount ?? d.driveLetter ?? ''),
        filesystem: text(d.filesystem ?? d.fs ?? ''),
        totalBytes: total,
        freeBytes: free,
        usedPct,
        health: health(d.health),
        temperatureC: number(d.temperatureC, { min: -40, max: 200 }),
        wearPct: number(d.wearPct, { min: 0, max: 100 }),
        readErrors: integer(d.readErrors, { min: 0, max: 2 ** 31 }),
        writeErrors: integer(d.writeErrors, { min: 0, max: 2 ** 31 }),
        powerOnHours: integer(d.powerOnHours, { min: 0, max: 2 ** 31 }),
        updatedAt: now,
      };
    })
    .filter(Boolean);

  const seenNics = new Set();
  const nics = (Array.isArray(body.nics) ? body.nics : [])
    .slice(0, MAX_NICS)
    .map((raw, index) => {
      const n = raw && typeof raw === 'object' ? raw : {};
      const name = text(n.name ?? n.id ?? `nic-${index}`, 120);
      if (!name) return null;
      const key = `agent:${name}`.slice(0, 160);
      if (seenNics.has(key)) return null;
      seenNics.add(key);
      return {
        nicKey: key,
        source: 'agent',
        name,
        mac: text(n.mac, 64),
        speedBps: number(n.speedBps, { min: 0, max: 10 ** 12 }),
        rxBps: number(n.rxBps, { min: 0, max: 10 ** 12 }),
        txBps: number(n.txBps, { min: 0, max: 10 ** 12 }),
        rxErrors: integer(n.rxErrors, { min: 0, max: 2 ** 31 }),
        txErrors: integer(n.txErrors, { min: 0, max: 2 ** 31 }),
        linkStatus: text(n.linkStatus ?? 'unknown', 32).toLowerCase(),
        updatedAt: now,
      };
    })
    .filter(Boolean);

  const volumes = disks.filter((d) => d.kind === 'volume' && d.totalBytes != null);
  const diskTotal = volumes.length ? volumes.reduce((sum, d) => sum + d.totalBytes, 0) : null;
  const diskUsed = volumes.length
    ? volumes.reduce((sum, d) => sum + Math.max(0, (d.totalBytes ?? 0) - (d.freeBytes ?? d.totalBytes ?? 0)), 0)
    : null;
  const diskMaxPct = volumes.length ? Math.max(...volumes.map((d) => d.usedPct ?? 0)) : null;
  const sumPresent = (values) => {
    const present = values.filter((value) => value != null);
    return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
  };
  const netRxBps = nics.length ? sumPresent(nics.map((n) => n.rxBps)) : null;
  const netTxBps = nics.length ? sumPresent(nics.map((n) => n.txBps)) : null;
  const netRxErrors = nics.length ? sumPresent(nics.map((n) => n.rxErrors)) : null;
  const netTxErrors = nics.length ? sumPresent(nics.map((n) => n.txErrors)) : null;
  const maxDiskTemp = disks.map((d) => d.temperatureC).filter((n) => n != null);
  const maxTempC = maxDiskTemp.length ? Math.max(...maxDiskTemp) : null;

  const healthValue = worstHealth([
    ...disks.map((d) => d.health),
    diskMaxPct != null && diskMaxPct >= 95 ? 'critical' : diskMaxPct != null && diskMaxPct >= 85 ? 'warning' : 'ok',
    cpuPct != null && cpuPct >= 95 ? 'warning' : 'ok',
    maxTempC != null && maxTempC >= 60 ? 'critical' : maxTempC != null && maxTempC >= 50 ? 'warning' : 'ok',
  ]);
  const hasData = cpuPct != null || memPct != null || disks.length > 0 || nics.length > 0;

  const inventoryRow = {
    manufacturer: text(inventory.manufacturer, 120),
    model: text(inventory.model, 120),
    serial: text(inventory.serial, 120),
    biosVersion: text(inventory.biosVersion, 120),
    cpuModel: text(cpu.model ?? inventory.cpuModel, 180),
    cpuCores: integer(cpu.cores ?? inventory.cpuCores, { min: 0, max: 4096 }),
    cpuThreads: integer(cpu.threads ?? inventory.cpuThreads, { min: 0, max: 8192 }),
    memoryTotalBytes: memTotal,
    osName: text(body.os?.name ?? inventory.osName, 180),
    osVersion: text(body.os?.version ?? inventory.osVersion, 120),
    raw: {},
  };

  return {
    collectedAt: collectedAt(body.collectedAt, now),
    metric: {
      source: 'agent',
      cpuPct,
      memTotalBytes: memTotal,
      memUsedBytes: memUsed,
      memPct,
      diskTotalBytes: diskTotal,
      diskUsedBytes: diskUsed,
      diskMaxPct,
      netRxBps,
      netTxBps,
      netRxErrors,
      netTxErrors,
      maxTempC,
      powerWatts: null,
      uptimeSec: integer(body.uptimeSec, { min: 0, max: 2 ** 40 }),
      health: hasData ? healthValue : 'unknown',
      raw: {},
    },
    disks,
    nics,
    inventory: inventoryRow,
    raw: {},
  };
}

export { GIB };
