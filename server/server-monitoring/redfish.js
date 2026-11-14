/**
 * NetWatch — جمع‌آورندهٔ Redfish برای BMC سوپرمایکرو
 * ----------------------------------------------------------------
 * Redfish یک API استاندارد HTTPS/JSON است و برای دما، فن، برق، سلامت درایو و
 * موجودی سخت‌افزار انتخاب اصلی است. IPMI 2.0 فقط fallback قدیمی است؛ در
 * ویندوز به ipmitool خارجی نیاز دارد و در بستهٔ Portable قرار داده نمی‌شود.
 *
 * چند واقعیت میدانی که کد را نسبت به آن‌ها مقاوم کرده است:
 *   • مدل‌های قدیمی‌تر Supermicro ممکن است Thermal قدیمی داشته باشند و
 *     ThermalSubsystem جدید نه؛ هر دو خوانده می‌شوند.
 *   • Sensors در نسل‌های مختلف به /Chassis/1/Sensors منتقل شده است؛ اگر
 *     Thermal دما نداشت، Sensors خوانده می‌شود.
 *   • برخی endpointها با license/firmware برنمی‌گردند (403/404). نبود یک
 *     منبع نباید کل Poll را از بین ببرد.
 *   • BMC یک SoC کوچک است؛ درخواست‌ها با هم‌زمانی محدود و timeout اجرا
 *     می‌شوند و هر بار session بسته می‌شود.
 */
import https from 'node:https';
import { decryptSecret } from '../credential-crypto.js';

const MAX_BODY = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10000;
const SENSOR_LIMIT = 64;
const DRIVE_LIMIT = 64;

const healthRank = { unknown: 0, ok: 1, warning: 2, critical: 3 };
function health(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'ok' || v === 'healthy' || v === 'enabled' || v === 'normal') return 'ok';
  if (v === 'warning' || v === 'warn' || v === 'caution' || v === 'degraded') return 'warning';
  if (v === 'critical' || v === 'unhealthy' || v === 'failed' || v === 'error') return 'critical';
  return 'unknown';
}
function worst(values) {
  let result = 'unknown';
  for (const value of values) {
    const h = health(value);
    if (healthRank[h] > healthRank[result]) result = h;
  }
  return result;
}
const num = (v, min = -Infinity, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function requestJson({ host, path, method = 'GET', headers = {}, body = null, verifyTls = true, ca = '', timeoutMs = REQUEST_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path,
        method,
        rejectUnauthorized: verifyTls !== false,
        ca: ca || undefined,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            req.destroy(new Error('پاسخ BMC بیش از حد بزرگ است.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          if (raw) {
            try {
              json = JSON.parse(raw);
            } catch {
              /* پاسخ غیر JSON برای بعضی خطاها طبیعی است */
            }
          }
          resolve({ status: Number(res.statusCode) || 0, headers: res.headers, json, raw });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('مهلت اتصال به BMC تمام شد.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function linksFrom(json) {
  const members = Array.isArray(json?.Members) ? json.Members : [];
  return members
    .map((m) => (typeof m === 'string' ? m : m?.['@odata.id']))
    .filter((p) => typeof p === 'string' && p.startsWith('/redfish/'))
    .slice(0, 256);
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        output[index] = await fn(items[index], index);
      } catch {
        output[index] = null;
      }
    }
  });
  await Promise.all(workers);
  return output.filter(Boolean);
}

function sensorType(raw) {
  const v = String(raw ?? '').toLowerCase();
  if (v.includes('temperature') || v.includes('temp')) return 'temperature';
  if (v.includes('fan') || v.includes('rpm')) return 'fan';
  if (v.includes('voltage') || v.includes('volt')) return 'voltage';
  if (v.includes('power') || v.includes('watt')) return 'power';
  return 'other';
}

function normalizeSensor(obj, index = 0) {
  if (!obj || typeof obj !== 'object') return null;
  const name = text(obj.Name ?? obj.Id ?? `sensor-${index}`, 160);
  if (!name) return null;
  const type = sensorType(obj.ReadingType ?? obj.Name);
  const reading = num(obj.Reading ?? obj.ReadingCelsius ?? obj.ReadingRPM ?? obj.ReadingVolts ?? obj.ReadingWatts);
  const units = text(obj.ReadingUnits ?? (obj.ReadingCelsius != null ? 'C' : obj.ReadingRPM != null ? 'RPM' : ''), 20);
  const thresholds = obj.Thresholds || {};
  return {
    sensorKey: `redfish:${text(obj.Id ?? name, 140)}`,
    source: 'redfish',
    name,
    type,
    reading,
    unit: units,
    status: health(obj.Status?.Health ?? obj.Status?.State),
    upperCritical: num(thresholds.UpperCritical?.Reading ?? thresholds.UpperCritical),
    upperCaution: num(thresholds.UpperCaution?.Reading ?? thresholds.UpperCaution),
    lowerCaution: num(thresholds.LowerCaution?.Reading ?? thresholds.LowerCaution),
    lowerCritical: num(thresholds.LowerCritical?.Reading ?? thresholds.LowerCritical),
  };
}

function thermalSensors(thermal) {
  const out = [];
  for (const t of Array.isArray(thermal?.Temperatures) ? thermal.Temperatures : []) {
    const s = normalizeSensor(
      {
        Id: t.MemberId ?? t.Name,
        Name: t.Name,
        ReadingType: 'Temperature',
        ReadingCelsius: t.ReadingCelsius,
        ReadingUnits: 'C',
        Status: t.Status,
        Thresholds: {
          UpperCritical: t.UpperThresholdCritical,
          UpperCaution: t.UpperThresholdNonCritical,
          LowerCaution: t.LowerThresholdNonCritical,
          LowerCritical: t.LowerThresholdCritical,
        },
      },
      out.length
    );
    if (s) out.push(s);
  }
  for (const f of Array.isArray(thermal?.Fans) ? thermal.Fans : []) {
    const s = normalizeSensor(
      {
        Id: f.MemberId ?? f.Name,
        Name: f.Name,
        ReadingType: 'Fan',
        Reading: f.Reading,
        ReadingUnits: f.ReadingUnits ?? 'RPM',
        Status: f.Status,
        Thresholds: f.Thresholds,
      },
      out.length
    );
    if (s) out.push(s);
  }
  return out;
}

export async function collectRedfish(profile) {
  const host = text(profile.bmc_ip, 120);
  if (!host) throw new Error('آدرس BMC تنظیم نشده است.');
  const username = decryptSecret(profile.bmc_username_enc, `server:${profile.id}`);
  const password = decryptSecret(profile.bmc_password_enc, `server:${profile.id}`);
  if (!username || !password) throw new Error('نام کاربری/رمز BMC تنظیم نشده است.');
  const verifyTls = profile.bmc_verify_tls !== 0;
  const ca = profile.bmc_ca_pem || '';
  const systemId = encodeURIComponent(text(profile.bmc_system_id || '1', 32));
  const chassisId = encodeURIComponent(text(profile.bmc_chassis_id || '1', 32));
  const base = `/redfish/v1`;
  let token = null;
  let sessionPath = null;
  let authMode = 'session';
  let lastRequestError = '';

  async function login() {
    try {
      const res = await requestJson({
        host,
        path: `${base}/SessionService/Sessions`,
        method: 'POST',
        body: { UserName: username, Password: password },
        verifyTls,
        ca,
      });
      if ((res.status === 200 || res.status === 201) && res.headers['x-auth-token']) {
        token = String(res.headers['x-auth-token']);
        sessionPath = res.headers.location ? String(res.headers.location) : null;
        return;
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('BMC نام کاربری یا رمز را رد کرد.');
      }
    } catch (e) {
      if (/رد کرد|نام کاربری/.test(e.message)) throw e;
      /* session در برخی BMCهای قدیمی نیست؛ Basic روی TLS امتحان می‌شود. */
    }
    authMode = 'basic';
  }

  async function logout() {
    if (!token || !sessionPath) return;
    try {
      await requestJson({
        host,
        path: sessionPath.startsWith('/') ? sessionPath : `/${sessionPath}`,
        method: 'DELETE',
        headers: { 'X-Auth-Token': token },
        verifyTls,
        ca,
      });
    } catch {
      /* بستن session نباید نتیجهٔ Poll را خراب کند */
    }
  }

  function authHeaders() {
    if (authMode === 'basic') {
      return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
    }
    return token ? { 'X-Auth-Token': token } : {};
  }

  async function get(path) {
    try {
      const res = await requestJson({ host, path, headers: authHeaders(), verifyTls, ca });
      if (res.status === 401 && authMode === 'session') {
        await login();
        const retry = await requestJson({ host, path, headers: authHeaders(), verifyTls, ca });
        return { status: retry.status, json: retry.json };
      }
      return { status: res.status, json: res.json };
    } catch (e) {
      lastRequestError = String(e?.message || e).slice(0, 240);
      return { status: 0, json: null, error: lastRequestError };
    }
  }

  await login();
  try {
    const system = (await get(`${base}/Systems/${systemId}`)).json;
    if (!system) {
      throw new Error(
        `سیستم Redfish در BMC پیدا نشد (Systems/${systemId}).` + (lastRequestError ? ` — ${lastRequestError}` : '')
      );
    }

    const manager = (await get(`${base}/Managers/1`)).json;
    const thermalLegacy = (await get(`${base}/Chassis/${chassisId}/Thermal`)).json;
    const powerLegacy = (await get(`${base}/Chassis/${chassisId}/Power`)).json;
    const thermalMetrics = (await get(`${base}/Chassis/${chassisId}/ThermalSubsystem/ThermalMetrics`)).json;

    const sensors = thermalSensors(thermalLegacy);
    const sensorLinks = linksFrom((await get(`${base}/Chassis/${chassisId}/Sensors`)).json);
    if (sensorLinks.length) {
      const fetched = await mapLimit(sensorLinks.slice(0, SENSOR_LIMIT), 4, async (path) => {
        const res = await get(path);
        return res.json ? normalizeSensor(res.json) : null;
      });
      // Sensors جدید معمولاً کامل‌تر است؛ همان کلیدهای تکراری حذف می‌شوند.
      const seen = new Set(sensors.map((s) => s.sensorKey));
      for (const s of fetched) {
        if (!s || seen.has(s.sensorKey)) continue;
        seen.add(s.sensorKey);
        sensors.push(s);
      }
    }
    // ThermalMetrics جدید در بعضی فریمورها خالی است؛ فقط اگر منبع دیگری نداشتیم
    // از خلاصهٔ آن استفاده می‌شود.
    const summary = thermalMetrics?.TemperatureSummary ?? thermalMetrics?.TemperatureSummaryCelsius;
    if (summary && !sensors.some((s) => s.type === 'temperature')) {
      const known = ['InletTemperatureCelsius', 'ExhaustTemperatureCelsius', 'TemperatureCelsius'];
      const keys = [...new Set([...known, ...Object.keys(summary)])];
      for (const key of keys) {
        const reading = num(summary[key]);
        if (reading == null) continue;
        sensors.push({
          sensorKey: `redfish:${key}`,
          source: 'redfish',
          name: key,
          type: 'temperature',
          reading,
          unit: 'C',
          status: health(thermalMetrics.Status?.Health),
          upperCritical: null,
          upperCaution: null,
          lowerCaution: null,
          lowerCritical: null,
        });
      }
    }

    const storageLinks = linksFrom((await get(`${base}/Systems/${systemId}/Storage`)).json);
    const disks = [];
    for (const storagePath of storageLinks.slice(0, 16)) {
      const storage = (await get(storagePath)).json;
      if (!storage) continue;
      const driveLinks = Array.isArray(storage.Drives) ? storage.Drives.map((d) => d?.['@odata.id']).filter(Boolean) : [];
      const drives = await mapLimit(driveLinks.slice(0, DRIVE_LIMIT), 4, async (path) => (await get(path)).json);
      for (const d of drives.filter(Boolean)) {
        const capacity = num(d.CapacityBytes, 0);
        const predicted = num(d.PredictedMediaLifeLeftPercent, 0, 100);
        const failure = d.FailurePredicted === true;
        disks.push({
          diskKey: `redfish:${text(storagePath, 90)}:${text(d.Id ?? d.Name ?? d.SerialNumber ?? `${disks.length}`, 120)}`,
          source: 'redfish',
          kind: 'physical',
          name: text(d.Name ?? d.Model ?? 'Drive', 160),
          mount: '',
          filesystem: '',
          totalBytes: capacity,
          freeBytes: null,
          usedPct: null,
          health: failure ? 'critical' : health(d.Status?.Health),
          temperatureC: num(d.TemperatureCelsius, -40, 200),
          wearPct: predicted == null ? null : Math.max(0, Math.min(100, 100 - predicted)),
          readErrors: null,
          writeErrors: null,
          powerOnHours: num(d.PowerOnHours, 0),
        });
      }
    }

    const processorLinks = linksFrom((await get(`${base}/Systems/${systemId}/Processors`)).json);
    const processors = await mapLimit(processorLinks.slice(0, 16), 3, async (path) => (await get(path)).json);
    const cpuModel = text(processors.find((p) => p?.Model)?.Model ?? system.ProcessorSummary?.Model, 180);
    const cpuCores = processors.reduce((sum, p) => sum + (num(p?.TotalCores, 0) ?? 0), 0) || num(system.ProcessorSummary?.CoreCount, 0);
    const cpuThreads = processors.reduce((sum, p) => sum + (num(p?.TotalThreads, 0) ?? 0), 0) || num(system.ProcessorSummary?.LogicalProcessorCount, 0);

    const memoryLinks = linksFrom((await get(`${base}/Systems/${systemId}/Memory`)).json);
    const dimms = await mapLimit(memoryLinks.slice(0, 64), 3, async (path) => (await get(path)).json);
    const dimmCount = dimms.filter((m) => m && m.CapacityMiB != null).length || null;
    const memoryBytes = dimms.length
      ? dimms.reduce((sum, m) => sum + (num(m?.CapacityMiB, 0) ?? 0) * 1024 * 1024, 0)
      : num(system.MemorySummary?.TotalSystemMemoryGiB, 0) != null
        ? num(system.MemorySummary.TotalSystemMemoryGiB) * 1024 ** 3
        : null;

    const nicLinks = linksFrom((await get(`${base}/Systems/${systemId}/EthernetInterfaces`)).json);
    const nics = await mapLimit(nicLinks.slice(0, 32), 3, async (path) => {
      const n = (await get(path)).json;
      if (!n) return null;
      return {
        nicKey: `redfish:${text(n.Id ?? n.Name ?? 'nic', 140)}`,
        source: 'redfish',
        name: text(n.Name ?? n.Id ?? 'NIC', 120),
        mac: text(n.MACAddress, 64),
        speedBps: num(n.SpeedMbps, 0) != null ? num(n.SpeedMbps) * 1_000_000 : null,
        rxBps: null,
        txBps: null,
        rxErrors: null,
        txErrors: null,
        linkStatus: text(n.LinkStatus ?? n.Status?.State ?? 'unknown', 32).toLowerCase(),
      };
    });

    const powerControl = Array.isArray(powerLegacy?.PowerControl) ? powerLegacy.PowerControl[0] : null;
    const powerWatts = num(powerControl?.PowerConsumedWatts);
    const supplies = Array.isArray(powerLegacy?.PowerSupplies) ? powerLegacy.PowerSupplies : [];
    const psuCount = supplies.length || null;
    const supplyHealth = supplies.map((p) => p?.Status?.Health);
    const systemHealth = health(system.Status?.Health ?? system.Status?.State);
    const managerHealth = health(manager?.Status?.Health ?? manager?.Status?.State);
    const diskHealth = disks.map((d) => d.health);
    const sensorHealth = sensors.map((s) => s.status);
    const maxTempC = (() => {
      const temps = sensors.filter((s) => s.type === 'temperature' && s.reading != null).map((s) => s.reading);
      return temps.length ? Math.max(...temps) : null;
    })();
    const diskTotal = disks.length ? disks.reduce((sum, d) => sum + (d.totalBytes ?? 0), 0) : null;

    return {
      collectedAt: Date.now(),
      metric: {
        source: 'redfish',
        cpuPct: null,
        memTotalBytes: memoryBytes,
        memUsedBytes: null,
        memPct: null,
        diskTotalBytes: diskTotal,
        diskUsedBytes: null,
        diskMaxPct: null,
        netRxBps: null,
        netTxBps: null,
        netRxErrors: null,
        netTxErrors: null,
        maxTempC,
        powerWatts,
        uptimeSec: null,
        health: worst([systemHealth, managerHealth, ...diskHealth, ...sensorHealth, ...supplyHealth]),
      },
      disks,
      nics,
      sensors,
      inventory: {
        manufacturer: text(system.Manufacturer, 120),
        model: text(system.Model, 120),
        serial: text(system.SerialNumber, 120),
        biosVersion: text(system.BiosVersion, 120),
        bmcFirmware: text(manager?.FirmwareVersion, 120),
        cpuModel,
        cpuCores,
        cpuThreads,
        memoryTotalBytes: memoryBytes,
        dimmCount,
        psuCount,
        osName: '',
        osVersion: '',
        raw: {
          redfishVersion: text(system.RedfishVersion ?? manager?.RedfishVersion, 32),
          powerState: text(system.PowerState, 32),
          systemHealth,
          managerHealth,
          sensorCount: sensors.length,
        },
      },
      raw: { source: 'redfish', systemId, chassisId },
    };
  } finally {
    await logout();
  }
}
