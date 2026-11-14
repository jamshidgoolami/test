/**
 * NetWatch — جمع‌آورندهٔ SMCIPMITool برای Windows
 * ----------------------------------------------------------------
 * SMCIPMITool ابزار رسمی Supermicro است و روی ویندوز به یک فایل اجرایی
 * آماده تبدیل می‌شود. این ماژول از IPMI استاندارد استفاده می‌کند؛ بنابراین
 * به لایسنس Redfish/OOB نیاز ندارد.
 *
 * خروجی SMCIPMITool با ipmitool یکی نیست؛ پارسرهای این فایل قالب جدولی
 * `ipmi sensor` و خروجی‌های FRU/خلاصه/NIC/SEL را به snapshot مشترک NetWatch
 * تبدیل می‌کنند. source همان `ipmi` است تا دادهٔ IPMI قبلی و این آداپتور
 * در یک کانال نمایش داده شوند.
 *
 * نکات امنیتی:
 *   • رمز در آرگومان خط فرمان قرار نمی‌گیرد؛ فایل موقت با مجوز 0600 ساخته
 *     می‌شود و در finally حذف می‌شود.
 *   • execFile (نه shell) استفاده می‌شود؛ ورودی کاربر به shell نمی‌رسد.
 *   • خروجی هر فرمان محدود و دارای timeout است.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptSecret } from '../credential-crypto.js';

const MAX_BUFFER = 4 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const SENSOR_LIMIT = 256;
const SEL_LIMIT = 30;

const STATUS = {
  ok: 'ok',
  nc: 'warning',
  cr: 'critical',
  nr: 'critical',
  ns: 'unknown',
  na: 'unknown',
  nrw: 'warning',
};

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function executableCandidates() {
  const name = 'SMCIPMITool.exe';
  const candidates = [];
  const configured = String(process.env.NETWATCH_SMCIPMITOOL || '').trim();
  if (configured) {
    try {
      candidates.push(fs.statSync(configured).isDirectory() ? path.join(configured, name) : configured);
    } catch {
      candidates.push(configured);
    }
  }
  candidates.push(
    path.join(toolRoot, 'SMCIPMITool', name),
    path.join(process.cwd(), 'SMCIPMITool', name),
    path.join(process.cwd(), name)
  );
  return [...new Set(candidates)];
}

export function resolveSmcIpmiExecutable() {
  for (const candidate of executableCandidates()) {
    try {
      if (candidate && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* مسیر بعدی را امتحان کن */
    }
  }
  return executableCandidates()[0];
}

function runSmcIpmi(exe, credentialsFile, host, command) {
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      ['-filemode', credentialsFile, '-i', host, '-c', command],
      {
        cwd: path.dirname(exe),
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const missing = error.code === 'ENOENT';
          const timedOut = error.killed || error.signal === 'SIGTERM';
          const detail = String(stderr || error.message || '').trim().slice(0, 500);
          const message = missing
            ? 'SMCIPMITool.exe پیدا نشد؛ پوشهٔ SMCIPMITool را در ریشهٔ NetWatch قرار دهید یا NETWATCH_SMCIPMITOOL را تنظیم کنید.'
            : timedOut
              ? 'SMCIPMITool در زمان مجاز پاسخ نداد؛ اتصال BMC یا بار سرور را بررسی کنید.'
              : detail || 'SMCIPMITool ناموفق بود.';
          const wrapped = new Error(message);
          wrapped.code = missing ? 'SMCIPMITOOL_MISSING' : timedOut ? 'SMCIPMITOOL_TIMEOUT' : 'SMCIPMITOOL_FAILED';
          reject(wrapped);
          return;
        }
        const text = String(stdout || '');
        const diagnostics = String(stderr || '').trim();
        if (!text.trim() && diagnostics) {
          reject(new Error(diagnostics.slice(0, 500)));
          return;
        }
        resolve(text);
      }
    );
  });
}

function cell(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function splitRow(line) {
  return String(line || '').split('|').map((part) => part.trim());
}

function isSeparator(line) {
  return /^[\s|:-]+$/.test(String(line || ''));
}

function cleanSensorName(value) {
  return cell(value)
    .replace(/^\(\s*\d+\s*\)\s*/, '')
    .replace(/^\d+\s+/, '')
    .slice(0, 160);
}

const UNIT_ALIASES = [
  [/^(c|°c|degrees?\s*c)$/i, 'C'],
  [/^(f|°f|degrees?\s*f)$/i, 'F'],
  [/^(v|volts?)$/i, 'V'],
  [/^(rpm)$/i, 'RPM'],
  [/^(w|watts?)$/i, 'W'],
  [/^(a|amps?|amperes?)$/i, 'A'],
  [/^%$/, '%'],
];

function normalizeUnit(value) {
  const raw = cell(value, 20);
  if (!raw) return '';
  for (const [pattern, unit] of UNIT_ALIASES) {
    if (pattern.test(raw)) return unit;
  }
  return raw;
}

/**
 * مقادیر SMCIPMITool می‌توانند عددی (`63C/145F`)، وضعیت (`Low`) یا
 * بایت خام (`00 C0 00 00`) باشند. فقط عدد + واحد شناخته‌شده را اندازه‌گیری
 * می‌کنیم تا بایت‌های وضعیت به‌اشتباه دما/ولتاژ ذخیره نشوند.
 */
export function parseMeasurement(value) {
  const raw = cell(value, 80);
  if (!raw || /^(n\/?a|low|high|not available)$/i.test(raw)) {
    return { reading: null, unit: '', text: raw };
  }
  const match = /^(-?\d+(?:\.\d+)?)\s*(c|°c|f|°f|v|volts?|rpm|w|watts?|a|amps?|amperes?|%)(?=\/|\s|$)/i.exec(raw);
  if (!match) return { reading: null, unit: '', text: raw };
  const valueNumber = Number(match[1]);
  if (!Number.isFinite(valueNumber)) return { reading: null, unit: '', text: raw };
  const unit = normalizeUnit(match[2]);
  if (/^F$/i.test(unit)) {
    return { reading: (valueNumber - 32) * (5 / 9), unit: 'C', text: raw };
  }
  return { reading: valueNumber, unit, text: raw };
}

function parseLimit(value) {
  const parsed = parseMeasurement(value);
  return parsed.reading == null ? null : parsed.reading;
}

function sensorType(name, unit, raw) {
  const text = `${name} ${unit} ${raw}`.toLowerCase();
  if (unit === 'C' || unit === 'F' || /\btemp(?:erature)?\b|thermal/.test(text)) return 'temperature';
  if (unit === 'RPM' || /\bfan\d*\b|fan speed/.test(text)) return 'fan';
  if (unit === 'V' || /\bvolt(?:age)?\b|vcore|vbat|vcc/.test(text)) return 'voltage';
  if (unit === 'W' || unit === 'A' || /\b(power|watt|amp|psu|pwr|ps)\b|power supply/.test(text)) return 'power';
  return 'other';
}

export function parseSensors(output) {
  const sensors = [];
  const seen = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line || isSeparator(line)) continue;
    const parts = splitRow(line);
    if (parts.length < 3) continue;
    const name = cleanSensorName(parts[1]);
    if (!name || /^\(?#?\)?\s*sensor$/i.test(name)) continue;
    const reading = parseMeasurement(parts[2]);
    const key = `ipmi:${name}`.slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    const rawStatus = cell(parts[0], 20).toLowerCase();
    const status = STATUS[rawStatus] || (rawStatus === '' ? 'unknown' : 'unknown');
    sensors.push({
      sensorKey: key,
      source: 'ipmi',
      name,
      type: sensorType(name, reading.unit, parts[2]),
      reading: reading.reading,
      unit: reading.unit,
      status,
      upperCritical: parseLimit(parts[4]),
      upperCaution: null,
      lowerCaution: null,
      lowerCritical: parseLimit(parts[3]),
    });
    if (sensors.length >= SENSOR_LIMIT) break;
  }
  return sensors;
}

export function parsePowerState(output) {
  const text = String(output || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = /\b(on|off)\b/i.exec(text);
  if (match) return match[1].toLowerCase();
  if (/\bS0\/G0\b/i.test(text)) return 'on';
  if (/\bS5\b/i.test(text)) return 'off';
  return '';
}

/**
 * FRU و summary با `Key = Value` یا `Key : Value` برمی‌گردند.
 * کلیدها با فاصله و دونقطه در مقدار حفظ می‌شوند.
 */
export function parseKeyValues(output) {
  const result = {};
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = /^\s*([^:=]{2,120}?)\s*[:=]\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = cell(match[1], 120);
    const value = cell(match[2], 500);
    if (key && value && result[key] === undefined) result[key] = value;
  }
  return result;
}

export function parseFru(output) {
  return parseKeyValues(output);
}

export function parseSummary(output) {
  return parseKeyValues(output);
}

export function parseNics(output) {
  const nics = [];
  const seen = new Set();
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line || isSeparator(line)) continue;
    const parts = splitRow(line);
    if (parts.length < 3) continue;
    const name = cell(parts[0], 120);
    const mac = cell(parts[2], 32);
    if (!name || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) continue;
    const key = `ipmi:${name}`.slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    const state = cell(parts[1], 20).toLowerCase();
    nics.push({
      nicKey: key,
      source: 'ipmi',
      name,
      mac,
      speedBps: null,
      rxBps: null,
      txBps: null,
      rxErrors: null,
      txErrors: null,
      linkStatus: /up|linkup|connected/i.test(state) ? 'up' : /down|linkdown|disconnected/i.test(state) ? 'down' : 'unknown',
    });
    if (nics.length >= 64) break;
  }
  return nics;
}

export function parseSel(output) {
  const entries = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line || isSeparator(line)) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(sel information|total entries|sel version|free space|recent entry|getting)/i.test(trimmed)) continue;
    if (/^(id|#|sel|event|date|time)\b/i.test(trimmed) && trimmed.includes('|')) continue;
    if (!/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|\d{2}:\d{2}/.test(trimmed) && !trimmed.includes('|')) continue;
    entries.push(trimmed.slice(0, 500));
    if (entries.length >= SEL_LIMIT * 2) break;
  }
  return {
    count: entries.length,
    entries: entries.slice(-SEL_LIMIT),
  };
}

function worstHealth(sensors) {
  if (sensors.some((s) => s.status === 'critical')) return 'critical';
  if (sensors.some((s) => s.status === 'warning')) return 'warning';
  if (sensors.every((s) => s.status === 'unknown')) return 'unknown';
  return 'ok';
}

function countDimms(sensors) {
  const names = new Set();
  for (const sensor of sensors) {
    const match = /\b((?:P\d+-)?DIMM(?:[A-Z]\d+|\d+[A-Z]?))\b/i.exec(sensor.name);
    if (match && sensor.reading != null) names.add(match[1].toUpperCase());
  }
  return names.size || null;
}

function countPsus(sensors) {
  const names = new Set();
  for (const sensor of sensors) {
    const match = /\b(?:PS|PSU)\s*(\d+)\b/i.exec(sensor.name);
    if (match) names.add(match[1]);
  }
  return names.size || null;
}

function powerWatts(sensors) {
  const values = sensors
    .filter((s) => s.type === 'power' && s.reading != null && /pwr|power|watt|psu/i.test(s.name))
    .map((s) => s.reading);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function temperatureMax(sensors) {
  const values = sensors.filter((s) => s.type === 'temperature' && s.reading != null).map((s) => s.reading);
  return values.length ? Math.max(...values) : null;
}

function valueByKey(values, suffix) {
  const key = Object.keys(values).find((name) => name.toLowerCase() === suffix.toLowerCase());
  return key ? values[key] : '';
}

function inventoryFromFru(fru, summary, sensors) {
  const field = (suffix) => valueByKey(fru, suffix);
  const summaryField = (suffix) => valueByKey(summary, suffix);
  return {
    manufacturer:
      field('Product Manufacturer Name') || field('Board Manufacturer Name') || field('Chassis Manufacturer') || 'Supermicro',
    model: field('Product Name') || field('Board Product Name') || '',
    serial: field('Product Serial Number') || field('Board Serial Number') || field('Chassis Serial Number') || '',
    biosVersion: summaryField('BIOS Version') || field('BIOS Version'),
    bmcFirmware: summaryField('Firmware Revision') || summaryField('Firmware Version') || '',
    cpuModel: '',
    cpuCores: null,
    cpuThreads: null,
    memoryTotalBytes: null,
    dimmCount: countDimms(sensors),
    psuCount: countPsus(sensors),
    osName: '',
    osVersion: '',
  };
}

/**
 * خروجی خام فرمان‌ها را بدون وابستگی به process/DB به snapshot تبدیل می‌کند.
 * برای تست و برای استفادهٔ مستقیم در collector export شده است.
 */
export function buildSnapshot(
  { sensorOutput = '', powerOutput = '', fruOutput = '', summaryOutput = '', macOutput = '', selOutput = '' },
  now = Date.now()
) {
  const sensors = parseSensors(sensorOutput);
  if (!sensors.length) {
    throw new Error('SMCIPMITool سنسوری برنگرداند؛ اعتبارنامه و دسترسی IPMI BMC را بررسی کنید.');
  }
  const fru = parseFru(fruOutput);
  const summary = parseSummary(summaryOutput);
  const powerState = parsePowerState(powerOutput);
  const nics = parseNics(macOutput);
  const sel = parseSel(selOutput);
  const baseInventory = inventoryFromFru(fru, summary, sensors);
  const maxTempC = temperatureMax(sensors);
  const watts = powerWatts(sensors);
  const health = worstHealth(sensors);
  const bmcMac = valueByKey(summary, 'MAC Address') || valueByKey(summary, 'System MAC Address 1') || '';
  const ipmiVersion = valueByKey(summary, 'IPMI Version') || '';

  return {
    collectedAt: now,
    metric: {
      source: 'ipmi',
      cpuPct: null,
      memTotalBytes: null,
      memUsedBytes: null,
      memPct: null,
      diskTotalBytes: null,
      diskUsedBytes: null,
      diskMaxPct: null,
      netRxBps: null,
      netTxBps: null,
      netRxErrors: null,
      netTxErrors: null,
      maxTempC,
      powerWatts: watts,
      uptimeSec: null,
      health,
    },
    disks: [],
    nics,
    sensors,
    inventory: {
      ...baseInventory,
      raw: {
        adapter: 'smcipmi',
        ipmiVersion,
        bmcMac,
        powerState,
        summary,
        fru,
        sel,
        sensorCount: sensors.length,
      },
    },
    raw: {
      source: 'ipmi',
      adapter: 'smcipmi',
      ipmiVersion,
      powerState,
      bmcMac,
    },
  };
}

async function optionalCommand(run, command) {
  try {
    return { output: await run(command), error: '' };
  } catch (e) {
    return { output: '', error: String(e?.message || e).slice(0, 300) };
  }
}

export async function collectSmcIpmi(profile) {
  const host = cell(profile.bmc_ip, 120);
  if (!host) throw new Error('آدرس BMC تنظیم نشده است.');
  const username = decryptSecret(profile.bmc_username_enc, `server:${profile.id}`);
  const password = decryptSecret(profile.bmc_password_enc, `server:${profile.id}`);
  if (!username || !password) throw new Error('نام کاربری/رمز IPMI تنظیم نشده است.');

  const exe = resolveSmcIpmiExecutable();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'netwatch-smc-'));
  const credentialsFile = path.join(directory, 'credentials.txt');
  try {
    if (/[\r\n]/.test(username) || /[\r\n]/.test(password)) {
      throw new Error('نام کاربری یا رمز SMCIPMITool نمی‌تواند خط جدید داشته باشد.');
    }
    await writeFile(credentialsFile, `username=${username}\npassword=${password}\n`, { mode: 0o600 });
    const run = (command) => runSmcIpmi(exe, credentialsFile, host, command);
    const sensorOutput = await run('ipmi sensor');
    const power = await optionalCommand(run, 'ipmi power status');
    const fru = await optionalCommand(run, 'ipmi fru');
    const summary = await optionalCommand(run, 'ipmi oem summary');
    const mac = await optionalCommand(run, 'ipmi oem mac');
    const sel = await optionalCommand(run, 'sel list');
    const snapshot = buildSnapshot(
      {
        sensorOutput,
        powerOutput: power.output,
        fruOutput: fru.output,
        summaryOutput: summary.output,
        macOutput: mac.output,
        selOutput: sel.output,
      },
      Date.now()
    );
    snapshot.inventory.raw.errors = {
      power: power.error,
      fru: fru.error,
      summary: summary.error,
      mac: mac.error,
      sel: sel.error,
    };
    snapshot.inventory.raw.executable = path.basename(exe);
    return snapshot;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
