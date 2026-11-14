/**
 * NetWatch — پشتیبان IPMI 2.0 برای BMCهای قدیمی‌تر Supermicro
 * ----------------------------------------------------------------
 * Redfish مسیر اصلی است. بعضی BMCهای X9/X10 با firmware قدیمی Redfish
 * کامل ندارند و فقط IPMI 2.0 دارند. پیاده‌سازی خالص JS از IPMI در اکوسیستم
 * Node نگه‌داری‌شده پیدا نشد؛ بنابراین از ipmitool رسمی استفاده می‌کنیم.
 *
 * نکات امنیتی:
 *   • رمز از آرگومان خط فرمان عبور نمی‌کند؛ با متغیر محیطی IPMI_PASSWORD و
 *     سوئیچ -E فقط به فرآیند فرزند داده می‌شود.
 *   • execFile (نه shell) و آرگومان‌های جدا؛ ورودی کاربر هرگز به shell نمی‌رسد.
 *   • خروجی محدود و هر فرمان timeout دارد؛ BMC تجهیز کند است.
 */
import { execFile } from 'node:child_process';
import { decryptSecret } from '../credential-crypto.js';

const MAX_BUFFER = 512 * 1024;
const TIMEOUT_MS = 15000;
const SENSOR_LIMIT = 256;

function runIpmi(args, password) {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.NETWATCH_IPMITOOL || 'ipmitool',
      args,
      {
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: { ...process.env, IPMI_PASSWORD: password },
      },
      (error, stdout, stderr) => {
        if (error) {
          const missing = error.code === 'ENOENT';
          const message = missing
            ? 'ipmitool پیدا نشد؛ آن را نصب کنید یا NETWATCH_IPMITOOL را تنظیم کنید.'
            : String(stderr || error.message || '').trim().slice(0, 400) || 'ipmitool ناموفق بود.';
          const wrapped = new Error(message);
          wrapped.code = missing ? 'IPMITOOL_MISSING' : 'IPMITOOL_FAILED';
          reject(wrapped);
          return;
        }
        resolve(String(stdout || ''));
      }
    );
  });
}

const HEALTH = { ok: 'ok', nc: 'warning', cr: 'critical', ns: 'unknown', na: 'unknown' };

function sensorType(name, unit) {
  const text = `${name} ${unit}`.toLowerCase();
  if (text.includes('rpm') || text.includes('fan')) return 'fan';
  if (text.includes('volt')) return 'voltage';
  if (text.includes('watt') || text.includes('amp') || text.includes('power')) return 'power';
  if (text.includes('degrees c') || text.includes('temp') || text.includes('°c')) return 'temperature';
  return 'other';
}

function parseSensors(output) {
  const sensors = [];
  const seen = new Set();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 3 || !parts[0]) continue;
    const name = parts[0].slice(0, 160);
    if (!/^\d/.test(parts[1]) && !/^-?\d/.test(parts[1])) continue;
    const match = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(parts[1]);
    if (!match) continue;
    const reading = Number(match[1]);
    if (!Number.isFinite(reading)) continue;
    const unit = match[2].replace(/degrees\s+c/i, 'C').replace(/degrees\s+f/i, 'F').slice(0, 20);
    const key = `ipmi:${name}`.slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    sensors.push({
      sensorKey: key,
      source: 'ipmi',
      name,
      type: sensorType(name, unit),
      reading,
      unit,
      status: HEALTH[parts[2].toLowerCase()] || 'unknown',
      upperCritical: null,
      upperCaution: null,
      lowerCaution: null,
      lowerCritical: null,
    });
    if (sensors.length >= SENSOR_LIMIT) break;
  }
  return sensors;
}

function parseKeyValues(output) {
  const result = {};
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key && value && result[key] === undefined) result[key] = value;
  }
  return result;
}

export async function collectIpmi(profile) {
  const host = String(profile.bmc_ip || '').trim();
  if (!host) throw new Error('آدرس BMC تنظیم نشده است.');
  const username = decryptSecret(profile.bmc_username_enc, `server:${profile.id}`);
  const password = decryptSecret(profile.bmc_password_enc, `server:${profile.id}`);
  if (!username || !password) throw new Error('نام کاربری/رمز IPMI تنظیم نشده است.');

  const base = ['-I', 'lanplus', '-H', host, '-U', username, '-E', '-N', '5', '-R', '1'];
  // BMCهای قدیمی اغلب تعداد session هم‌زمان محدودی دارند؛ فرمان‌ها را
  // ترتیبی اجرا می‌کنیم تا یک Poll، session دیگری را بیرون نکند.
  const mcInfo = await runIpmi([...base, 'mc', 'info'], password).catch(() => '');
  const sdr = await runIpmi([...base, 'sdr'], password);
  const fru = await runIpmi([...base, 'fru'], password).catch(() => '');
  const powerState = await runIpmi([...base, 'chassis', 'power', 'status'], password).catch(() => '');

  const sensors = parseSensors(sdr);
  if (!sensors.length) throw new Error('IPMI سنسوری برنگرداند؛ اعتبارنامه و دسترسی BMC را بررسی کنید.');
  const mc = parseKeyValues(mcInfo);
  const fruValues = parseKeyValues(fru);
  const temperature = sensors.filter((s) => s.type === 'temperature' && s.reading != null).map((s) => s.reading);
  const maxTempC = temperature.length ? Math.max(...temperature) : null;
  const powerSensors = sensors.filter(
    (s) => s.type === 'power' && s.reading != null && /(pwr|power|watt|psu)/i.test(`${s.name} ${s.unit}`)
  );
  const powerWatts = powerSensors.length ? powerSensors.reduce((sum, s) => sum + s.reading, 0) : null;
  const health = sensors.some((s) => s.status === 'critical')
    ? 'critical'
    : sensors.some((s) => s.status === 'warning')
      ? 'warning'
      : sensors.every((s) => s.status === 'unknown')
        ? 'unknown'
        : 'ok';

  return {
    collectedAt: Date.now(),
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
      powerWatts,
      uptimeSec: null,
      health,
    },
    disks: [],
    nics: [],
    sensors,
    inventory: {
      manufacturer: fruValues['Board Mfg'] || mc['Manufacturer Name'] || 'Supermicro',
      model: fruValues['Product Name'] || mc['Product Name'] || '',
      serial: fruValues['Product Serial'] || fruValues['Board Serial'] || '',
      biosVersion: '',
      bmcFirmware: mc['Firmware Revision'] || mc['Firmware Version'] || '',
      cpuModel: '',
      cpuCores: null,
      cpuThreads: null,
      memoryTotalBytes: null,
      dimmCount: null,
      psuCount: null,
      osName: '',
      osVersion: '',
      raw: {
        ipmiVersion: mc['IPMI Version'] || '',
        powerState: powerState.trim().slice(0, 80),
        sensorCount: sensors.length,
      },
    },
    raw: { source: 'ipmi' },
  };
}
