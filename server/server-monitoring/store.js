/**
 * NetWatch — لایهٔ دادهٔ پایش سرور
 * ----------------------------------------------------------------
 * سرورها، snapshotهای فعلی و تاریخچهٔ سبک در همین ماژول نگه‌داری می‌شوند.
 * هیچ اعتبارنامهٔ خامی به API برنمی‌گردد؛ نام کاربری BMC فقط برای فرم
 * ویرایش و با مجوز servers:write رمزگشایی می‌شود و رمز هرگز برگردانده نمی‌شود.
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { isValidHost } from '../ping.js';
import { encryptSecret, tryDecryptSecret } from '../credential-crypto.js';
import { logEvent } from '../logger.mjs';
import { evaluateServerAlerts } from './alerts.js';

export const SERVER_HEALTH = Object.freeze(['unknown', 'ok', 'warning', 'critical']);
const HEALTH_RANK = { unknown: 0, ok: 1, warning: 2, critical: 3 };
const PROTOCOLS = new Set(['redfish', 'ipmi', 'demo', 'none']);
const RANGE = {
  '15m': { ms: 15 * 60 * 1000, bucket: 60 * 1000 },
  '1h': { ms: 60 * 60 * 1000, bucket: 5 * 60 * 1000 },
  '6h': { ms: 6 * 60 * 60 * 1000, bucket: 15 * 60 * 1000 },
  '24h': { ms: 24 * 60 * 60 * 1000, bucket: 60 * 60 * 1000 },
  '7d': { ms: 7 * 24 * 60 * 60 * 1000, bucket: 6 * 60 * 60 * 1000 },
  '30d': { ms: 30 * 24 * 60 * 60 * 1000, bucket: 24 * 60 * 60 * 1000 },
};

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const bool = (value, fallback = false) => (value === undefined ? fallback : value === true || value === 1 || value === '1' || value === 'true');
const int = (value, min, max, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const alertThreshold = (value, min, max, label, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw Object.assign(new Error(`${label} باید بین ${min} و ${max} باشد.`), { status: 400 });
  }
  return n;
};
const health = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (SERVER_HEALTH.includes(v) && v !== 'unknown') return v;
  if (v === 'healthy' || v === 'ok') return 'ok';
  if (v === 'warn' || v === 'warning' || v === 'caution') return 'warning';
  if (v === 'critical' || v === 'unhealthy' || v === 'failed') return 'critical';
  return 'unknown';
};
const worst = (values) => {
  let result = 'unknown';
  for (const value of values) {
    const h = health(value);
    if (HEALTH_RANK[h] > HEALTH_RANK[result]) result = h;
  }
  return result;
};
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newAgentToken = () => `nw_${crypto.randomBytes(32).toString('base64url')}`;
const aad = (id) => `server:${id}`;

function publicServer(row) {
  if (!row) return null;
  const agentLast = row.last_agent_at ?? null;
  const pollLast = row.last_poll_at ?? null;
  const lastSeenAt = Math.max(agentLast ?? 0, pollLast ?? 0) || null;
  const interval = Number(row.poll_interval_sec) || 60;
  return {
    id: row.id,
    name: row.name,
    osHostname: row.os_hostname || '',
    osIp: row.os_ip || '',
    vendor: row.vendor || '',
    model: row.model || '',
    serial: row.serial || '',
    location: row.location || '',
    rack: row.rack || '',
    enabled: !!row.enabled,
    agentConfigured: !!row.agent_key_hash,
    agentKeyPrefix: row.agent_key_prefix || '',
    agentRegisteredAt: row.agent_registered_at ?? null,
    bmcIp: row.bmc_ip || '',
    bmcProtocol: row.bmc_protocol || 'redfish',
    bmcUsername: tryDecryptSecret(row.bmc_username_enc, aad(row.id)),
    hasBmcPassword: !!row.bmc_password_enc,
    bmcVerifyTls: !!row.bmc_verify_tls,
    bmcHasCa: !!row.bmc_ca_pem,
    bmcSystemId: row.bmc_system_id || '1',
    bmcChassisId: row.bmc_chassis_id || '1',
    pollIntervalSec: interval,
    alertEnabled: !!row.alert_enabled,
    alertCpuPct: Number(row.alert_cpu_pct) || 90,
    alertMemPct: Number(row.alert_mem_pct) || 90,
    alertTempC: row.alert_temp_c == null ? 80 : Number(row.alert_temp_c),
    lastPollAt: pollLast,
    lastPollOk: row.last_poll_ok == null ? null : !!row.last_poll_ok,
    lastPollError: row.last_poll_error || '',
    lastAgentAt: agentLast,
    lastAgentError: row.last_agent_error || '',
    lastSeenAt,
    stale: !lastSeenAt || Date.now() - lastSeenAt > interval * 3 * 1000,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function metricRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ts: row.ts,
    source: row.source,
    cpuPct: row.cpu_pct,
    memTotalBytes: row.mem_total_bytes,
    memUsedBytes: row.mem_used_bytes,
    memPct: row.mem_pct,
    diskTotalBytes: row.disk_total_bytes,
    diskUsedBytes: row.disk_used_bytes,
    diskMaxPct: row.disk_max_pct,
    netRxBps: row.net_rx_bps,
    netTxBps: row.net_tx_bps,
    netRxErrors: row.net_rx_errors,
    netTxErrors: row.net_tx_errors,
    maxTempC: row.max_temp_c,
    powerWatts: row.power_watts,
    uptimeSec: row.uptime_sec,
    health: row.health,
  };
}

function inventoryRow(row) {
  if (!row) return null;
  return {
    manufacturer: row.manufacturer || '',
    model: row.model || '',
    serial: row.serial || '',
    biosVersion: row.bios_version || '',
    bmcFirmware: row.bmc_firmware || '',
    cpuModel: row.cpu_model || '',
    cpuCores: row.cpu_cores,
    cpuThreads: row.cpu_threads,
    memoryTotalBytes: row.memory_total_bytes,
    dimmCount: row.dimm_count,
    psuCount: row.psu_count,
    osName: row.os_name || '',
    osVersion: row.os_version || '',
    updatedAt: row.updated_at,
  };
}

function diskRow(row) {
  return {
    key: row.disk_key,
    source: row.source,
    kind: row.kind,
    name: row.name,
    mount: row.mount,
    filesystem: row.filesystem,
    totalBytes: row.total_bytes,
    freeBytes: row.free_bytes,
    usedPct: row.used_pct,
    health: row.health,
    temperatureC: row.temperature_c,
    wearPct: row.wear_pct,
    readErrors: row.read_errors,
    writeErrors: row.write_errors,
    powerOnHours: row.power_on_hours,
    updatedAt: row.updated_at,
  };
}

function nicRow(row) {
  return {
    key: row.nic_key,
    source: row.source,
    name: row.name,
    mac: row.mac,
    speedBps: row.speed_bps,
    rxBps: row.rx_bps,
    txBps: row.tx_bps,
    rxErrors: row.rx_errors,
    txErrors: row.tx_errors,
    linkStatus: row.link_status,
    updatedAt: row.updated_at,
  };
}

function sensorRow(row) {
  return {
    key: row.sensor_key,
    source: row.source,
    name: row.name,
    type: row.sensor_type,
    reading: row.reading,
    unit: row.unit,
    status: row.status,
    upperCritical: row.upper_critical,
    upperCaution: row.upper_caution,
    lowerCaution: row.lower_caution,
    lowerCritical: row.lower_critical,
    updatedAt: row.updated_at,
  };
}

export function getServerRow(id) {
  return db.prepare('SELECT * FROM servers WHERE id = ?').get(Number(id)) || null;
}

export function getLatestMetric(serverId, source) {
  return metricRow(
    db
      .prepare('SELECT * FROM server_metrics WHERE server_id = ? AND source = ? ORDER BY ts DESC, id DESC LIMIT 1')
      .get(Number(serverId), source)
  );
}

export function getServer(id) {
  return publicServer(getServerRow(id));
}

export function listServers() {
  const rows = db.prepare('SELECT * FROM servers ORDER BY name COLLATE NOCASE, id').all();
  const alertCounts = new Map(
    db
      .prepare("SELECT server_id, COUNT(*) AS c FROM alerts WHERE server_id IS NOT NULL AND status = 'active' GROUP BY server_id")
      .all()
      .map((r) => [r.server_id, r.c])
  );
  const items = rows.map((row) => {
    const server = publicServer(row);
    const agent = getLatestMetric(row.id, 'agent');
    const redfish = getLatestMetric(row.id, 'redfish');
    const ipmi = getLatestMetric(row.id, 'ipmi');
    const demo = getLatestMetric(row.id, 'demo');
    return {
      ...server,
      latest: {
        agent,
        redfish,
        ipmi,
        demo,
        health: worst([agent?.health, redfish?.health, ipmi?.health, demo?.health]),
      },
      openAlerts: alertCounts.get(row.id) || 0,
    };
  });
  const summary = {
    total: items.length,
    enabled: items.filter((s) => s.enabled).length,
    online: items.filter((s) => !s.stale).length,
    stale: items.filter((s) => s.stale).length,
    healthy: items.filter((s) => s.latest.health === 'ok').length,
    warning: items.filter((s) => s.latest.health === 'warning').length,
    critical: items.filter((s) => s.latest.health === 'critical').length,
    unknown: items.filter((s) => s.latest.health === 'unknown').length,
    avgCpuPct: (() => {
      const values = items.map((s) => s.latest.agent?.cpuPct).filter((n) => n != null);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    })(),
    maxTempC: (() => {
      const values = items
        .map((s) => s.latest.redfish?.maxTempC ?? s.latest.ipmi?.maxTempC ?? s.latest.demo?.maxTempC)
        .filter((n) => n != null);
      return values.length ? Math.max(...values) : null;
    })(),
  };
  return { items, summary };
}

export function getServerDetail(id) {
  const row = getServerRow(id);
  if (!row) return null;
  const server = publicServer(row);
  const inventory = inventoryRow(db.prepare('SELECT * FROM server_inventory WHERE server_id = ?').get(row.id));
  const disks = db.prepare('SELECT * FROM server_disks WHERE server_id = ? ORDER BY kind, name COLLATE NOCASE').all(row.id).map(diskRow);
  const nics = db.prepare('SELECT * FROM server_nics WHERE server_id = ? ORDER BY name COLLATE NOCASE').all(row.id).map(nicRow);
  const sensors = db
    .prepare('SELECT * FROM server_sensors WHERE server_id = ? ORDER BY sensor_type, name COLLATE NOCASE')
    .all(row.id)
    .map(sensorRow);
  const agent = getLatestMetric(row.id, 'agent');
  const redfish = getLatestMetric(row.id, 'redfish');
  const ipmi = getLatestMetric(row.id, 'ipmi');
  const demo = getLatestMetric(row.id, 'demo');
  const openAlerts = db
    .prepare("SELECT COUNT(*) AS c FROM alerts WHERE server_id = ? AND status = 'active'")
    .get(row.id).c;
  return {
    ...server,
    openAlerts,
    inventory,
    disks,
    nics,
    sensors,
    latest: { agent, redfish, ipmi, demo, health: worst([agent?.health, redfish?.health, ipmi?.health, demo?.health]) },
  };
}

function normalizeInput(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) {
    const name = text(input.name, 120);
    if (!name) throw Object.assign(new Error('نام سرور الزامی است.'), { status: 400 });
    out.name = name;
  }
  const textFields = {
    osHostname: ['os_hostname', 120],
    osIp: ['os_ip', 80],
    vendor: ['vendor', 120],
    model: ['model', 120],
    serial: ['serial', 120],
    location: ['location', 180],
    rack: ['rack', 80],
    bmcIp: ['bmc_ip', 80],
    bmcSystemId: ['bmc_system_id', 32],
    bmcChassisId: ['bmc_chassis_id', 32],
  };
  for (const [key, [column, max]] of Object.entries(textFields)) {
    if (partial && input[key] === undefined) continue;
    const value = text(input[key], max);
    if ((key === 'osIp' || key === 'bmcIp') && value && !isValidHost(value)) {
      throw Object.assign(new Error(`${key === 'bmcIp' ? 'آدرس BMC' : 'آدرس IP سرور'} معتبر نیست.`), { status: 400 });
    }
    out[column] = value;
  }
  if (!partial || input.bmcProtocol !== undefined) {
    const protocol = text(input.bmcProtocol || 'redfish', 20).toLowerCase();
    if (!PROTOCOLS.has(protocol)) throw Object.assign(new Error('پروتکل BMC باید redfish، ipmi، demo یا none باشد.'), { status: 400 });
    out.bmc_protocol = protocol;
  }
  if (!partial || input.enabled !== undefined) out.enabled = bool(input.enabled, true) ? 1 : 0;
  if (!partial || input.bmcVerifyTls !== undefined) out.bmc_verify_tls = bool(input.bmcVerifyTls, true) ? 1 : 0;
  if (!partial || input.pollIntervalSec !== undefined) out.poll_interval_sec = int(input.pollIntervalSec, 30, 3600, 60);
  if (!partial || input.alertEnabled !== undefined) out.alert_enabled = bool(input.alertEnabled, true) ? 1 : 0;
  if (!partial || input.alertCpuPct !== undefined) {
    out.alert_cpu_pct = alertThreshold(input.alertCpuPct, 1, 100, 'آستانهٔ CPU', 90);
  }
  if (!partial || input.alertMemPct !== undefined) {
    out.alert_mem_pct = alertThreshold(input.alertMemPct, 1, 100, 'آستانهٔ RAM', 90);
  }
  if (!partial || input.alertTempC !== undefined) {
    out.alert_temp_c = alertThreshold(input.alertTempC, 0, 150, 'آستانهٔ دما', 80);
  }
  if (!partial || input.bmcCaPem !== undefined) {
    const pem = text(input.bmcCaPem, 16 * 1024);
    if (pem && !pem.includes('BEGIN CERTIFICATE')) throw Object.assign(new Error('CA PEM معتبر نیست.'), { status: 400 });
    out.bmc_ca_pem = pem;
  }
  return out;
}

export function createServer(input = {}) {
  const fields = normalizeInput(input);
  const now = Date.now();
  const token = newAgentToken();
  let id;
  db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO servers
         (name, os_hostname, os_ip, vendor, model, serial, location, rack, enabled,
          agent_key_hash, agent_key_prefix, bmc_ip, bmc_protocol, bmc_verify_tls,
          bmc_ca_pem, bmc_system_id, bmc_chassis_id, poll_interval_sec,
          alert_enabled, alert_cpu_pct, alert_mem_pct, alert_temp_c, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        fields.name,
        fields.os_hostname || '',
        fields.os_ip || '',
        fields.vendor || 'Supermicro',
        fields.model || '',
        fields.serial || '',
        fields.location || '',
        fields.rack || '',
        fields.enabled ?? 1,
        hashToken(token),
        token.slice(0, 10),
        fields.bmc_ip || '',
        fields.bmc_protocol || 'redfish',
        fields.bmc_verify_tls ?? 1,
        fields.bmc_ca_pem || '',
        fields.bmc_system_id || '1',
        fields.bmc_chassis_id || '1',
        fields.poll_interval_sec ?? 60,
        fields.alert_enabled ?? 1,
        fields.alert_cpu_pct ?? 90,
        fields.alert_mem_pct ?? 90,
        fields.alert_temp_c ?? 80,
        now,
        now
      );
    id = Number(result.lastInsertRowid);
    const username = text(input.bmcUsername, 120);
    const password = String(input.bmcPassword ?? '').slice(0, 512);
    if (username || password) {
      db.prepare('UPDATE servers SET bmc_username_enc = ?, bmc_password_enc = ? WHERE id = ?').run(
        username ? encryptSecret(username, aad(id)) : '',
        password ? encryptSecret(password, aad(id)) : '',
        id
      );
    }
  }, { label: 'server.create' });
  return { server: getServer(id), agentToken: token };
}

export function updateServer(id, input = {}) {
  const current = getServerRow(id);
  if (!current) return null;
  const fields = normalizeInput(input, { partial: true });
  const sets = [];
  const params = [];
  for (const [column, value] of Object.entries(fields)) {
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (input.bmcUsername !== undefined) {
    const username = text(input.bmcUsername, 120);
    sets.push('bmc_username_enc = ?');
    params.push(username ? encryptSecret(username, aad(current.id)) : '');
  }
  if (input.clearBmcPassword === true) {
    sets.push('bmc_password_enc = ?');
    params.push('');
  } else if (input.bmcPassword !== undefined && String(input.bmcPassword) !== '') {
    sets.push('bmc_password_enc = ?');
    params.push(encryptSecret(String(input.bmcPassword), aad(current.id)));
  }
  let token = null;
  if (input.rotateAgentToken === true) {
    token = newAgentToken();
    sets.push('agent_key_hash = ?', 'agent_key_prefix = ?', 'agent_registered_at = NULL');
    params.push(hashToken(token), token.slice(0, 10));
  }
  sets.push('updated_at = ?');
  params.push(Date.now(), current.id);
  db.prepare(`UPDATE servers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return { server: getServer(current.id), agentToken: token };
}

export function rotateAgentToken(id) {
  const current = getServerRow(id);
  if (!current) return null;
  const token = newAgentToken();
  db.prepare('UPDATE servers SET agent_key_hash = ?, agent_key_prefix = ?, agent_registered_at = NULL, updated_at = ? WHERE id = ?').run(
    hashToken(token),
    token.slice(0, 10),
    Date.now(),
    current.id
  );
  return { server: getServer(current.id), agentToken: token };
}

export function deleteServer(id) {
  return db.prepare('DELETE FROM servers WHERE id = ?').run(Number(id)).changes > 0;
}

export function serverForAgentToken(token) {
  if (!token || String(token).length < 20) return null;
  return db.prepare('SELECT * FROM servers WHERE agent_key_hash = ? AND enabled = 1').get(hashToken(token)) || null;
}

function upsertInventory(serverId, inventory, now) {
  if (!inventory) return;
  db.prepare(
    `INSERT INTO server_inventory
     (server_id, manufacturer, model, serial, bios_version, bmc_firmware, cpu_model, cpu_cores,
      cpu_threads, memory_total_bytes, dimm_count, psu_count, os_name, os_version, raw_json, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(server_id) DO UPDATE SET
       manufacturer = COALESCE(NULLIF(excluded.manufacturer,''), server_inventory.manufacturer),
       model = COALESCE(NULLIF(excluded.model,''), server_inventory.model),
       serial = COALESCE(NULLIF(excluded.serial,''), server_inventory.serial),
       bios_version = COALESCE(NULLIF(excluded.bios_version,''), server_inventory.bios_version),
       bmc_firmware = COALESCE(NULLIF(excluded.bmc_firmware,''), server_inventory.bmc_firmware),
       cpu_model = COALESCE(NULLIF(excluded.cpu_model,''), server_inventory.cpu_model),
       cpu_cores = COALESCE(excluded.cpu_cores, server_inventory.cpu_cores),
       cpu_threads = COALESCE(excluded.cpu_threads, server_inventory.cpu_threads),
       memory_total_bytes = COALESCE(excluded.memory_total_bytes, server_inventory.memory_total_bytes),
       dimm_count = COALESCE(excluded.dimm_count, server_inventory.dimm_count),
       psu_count = COALESCE(excluded.psu_count, server_inventory.psu_count),
       os_name = COALESCE(NULLIF(excluded.os_name,''), server_inventory.os_name),
       os_version = COALESCE(NULLIF(excluded.os_version,''), server_inventory.os_version),
       raw_json = excluded.raw_json,
       updated_at = excluded.updated_at`
  ).run(
    serverId,
    inventory.manufacturer || '',
    inventory.model || '',
    inventory.serial || '',
    inventory.biosVersion || '',
    inventory.bmcFirmware || '',
    inventory.cpuModel || '',
    inventory.cpuCores ?? null,
    inventory.cpuThreads ?? null,
    inventory.memoryTotalBytes ?? null,
    inventory.dimmCount ?? null,
    inventory.psuCount ?? null,
    inventory.osName || '',
    inventory.osVersion || '',
    JSON.stringify(inventory.raw || {}).slice(0, 64 * 1024),
    now
  );
}

function replaceDisks(serverId, source, disks, now) {
  db.prepare('DELETE FROM server_disks WHERE server_id = ? AND source = ?').run(serverId, source);
  const insert = db.prepare(
    `INSERT INTO server_disks
     (server_id, disk_key, source, kind, name, mount, filesystem, total_bytes, free_bytes, used_pct,
      health, temperature_c, wear_pct, read_errors, write_errors, power_on_hours, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const d of disks.slice(0, 128)) {
    insert.run(
      serverId,
      d.diskKey,
      source,
      d.kind || 'volume',
      d.name || '',
      d.mount || '',
      d.filesystem || '',
      d.totalBytes ?? null,
      d.freeBytes ?? null,
      d.usedPct ?? null,
      health(d.health),
      d.temperatureC ?? null,
      d.wearPct ?? null,
      d.readErrors ?? null,
      d.writeErrors ?? null,
      d.powerOnHours ?? null,
      now
    );
  }
}

function replaceNics(serverId, source, nics, now) {
  db.prepare('DELETE FROM server_nics WHERE server_id = ? AND source = ?').run(serverId, source);
  const insert = db.prepare(
    `INSERT INTO server_nics
     (server_id, nic_key, source, name, mac, speed_bps, rx_bps, tx_bps, rx_errors, tx_errors, link_status, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const n of nics.slice(0, 64)) {
    insert.run(
      serverId,
      n.nicKey,
      source,
      n.name || '',
      n.mac || '',
      n.speedBps ?? null,
      n.rxBps ?? null,
      n.txBps ?? null,
      n.rxErrors ?? null,
      n.txErrors ?? null,
      n.linkStatus || 'unknown',
      now
    );
  }
}

function replaceSensors(serverId, source, sensors, now) {
  db.prepare('DELETE FROM server_sensors WHERE server_id = ? AND source = ?').run(serverId, source);
  const insert = db.prepare(
    `INSERT INTO server_sensors
     (server_id, sensor_key, source, name, sensor_type, reading, unit, status,
      upper_critical, upper_caution, lower_caution, lower_critical, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const s of sensors.slice(0, 256)) {
    insert.run(
      serverId,
      s.sensorKey,
      source,
      s.name || '',
      s.type || 'other',
      s.reading ?? null,
      s.unit || '',
      health(s.status),
      s.upperCritical ?? null,
      s.upperCaution ?? null,
      s.lowerCaution ?? null,
      s.lowerCritical ?? null,
      now
    );
  }
}

/**
 * یک snapshot را اتمیک ذخیره می‌کند. source تعیین می‌کند کدام کانال
 * (agent/redfish/demo) به‌روز شده است تا دادهٔ کانال دیگر پاک نشود.
 */
export function ingestSnapshot(serverId, snapshot, source) {
  const now = Date.now();
  const metric = snapshot.metric || {};
  const ts = snapshot.collectedAt || now;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO server_metrics
       (server_id, ts, source, cpu_pct, mem_total_bytes, mem_used_bytes, mem_pct,
        disk_total_bytes, disk_used_bytes, disk_max_pct, net_rx_bps, net_tx_bps,
        net_rx_errors, net_tx_errors, max_temp_c, power_watts, uptime_sec, health, raw_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      serverId,
      ts,
      source,
      metric.cpuPct ?? null,
      metric.memTotalBytes ?? null,
      metric.memUsedBytes ?? null,
      metric.memPct ?? null,
      metric.diskTotalBytes ?? null,
      metric.diskUsedBytes ?? null,
      metric.diskMaxPct ?? null,
      metric.netRxBps ?? null,
      metric.netTxBps ?? null,
      metric.netRxErrors ?? null,
      metric.netTxErrors ?? null,
      metric.maxTempC ?? null,
      metric.powerWatts ?? null,
      metric.uptimeSec ?? null,
      health(metric.health),
      JSON.stringify(snapshot.raw || {}).slice(0, 64 * 1024)
    );
    upsertInventory(serverId, snapshot.inventory, now);
    replaceDisks(serverId, source, snapshot.disks || [], now);
    replaceNics(serverId, source, snapshot.nics || [], now);
    replaceSensors(serverId, source, snapshot.sensors || [], now);
    if (source === 'agent') {
      db.prepare(
        "UPDATE servers SET last_agent_at = ?, last_agent_error = '', agent_registered_at = COALESCE(agent_registered_at, ?), updated_at = ? WHERE id = ?"
      ).run(now, now, now, serverId);
    } else {
      db.prepare("UPDATE servers SET last_poll_at = ?, last_poll_ok = 1, last_poll_error = '', updated_at = ? WHERE id = ?").run(
        now,
        now,
        serverId
      );
    }
  }, { label: 'server.ingest' });
  try {
    // ارزیابی پس از Commit انجام می‌شود تا هشدار هرگز از دادهٔ ذخیره‌نشده ساخته نشود.
    evaluateServerAlerts(getServerRow(serverId), snapshot, now);
  } catch (e) {
    logEvent('warn', 'server_alert_evaluation_failed', { serverId, message: e.message });
  }
  return { ts, source };
}

export function markPollFailure(serverId, message) {
  const now = Date.now();
  db.prepare('UPDATE servers SET last_poll_at = ?, last_poll_ok = 0, last_poll_error = ?, updated_at = ? WHERE id = ?').run(
    now,
    String(message || 'خطای نامشخص').slice(0, 500),
    now,
    serverId
  );
}

export function seriesFor(serverId, range = '1h') {
  const spec = RANGE[range] || RANGE['1h'];
  const from = Date.now() - spec.ms;
  const rows = db
    .prepare(
      `SELECT (ts / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS t,
              AVG(cpu_pct) AS cpu_pct, AVG(mem_pct) AS mem_pct,
              MAX(disk_max_pct) AS disk_max_pct,
              AVG(net_rx_bps) AS net_rx_bps, AVG(net_tx_bps) AS net_tx_bps,
              MAX(max_temp_c) AS max_temp_c, MAX(power_watts) AS power_watts,
              MAX(CASE health WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 WHEN 'ok' THEN 1 ELSE 0 END) AS health_rank
       FROM server_metrics WHERE server_id = ? AND ts >= ?
       GROUP BY t ORDER BY t`
    )
    .all(spec.bucket, spec.bucket, Number(serverId), from);
  const rank = { 0: 'unknown', 1: 'ok', 2: 'warning', 3: 'critical' };
  return {
    range,
    bucketMs: spec.bucket,
    from,
    to: Date.now(),
    points: rows.map((r) => ({
      t: r.t,
      cpuPct: r.cpu_pct,
      memPct: r.mem_pct,
      diskMaxPct: r.disk_max_pct,
      netRxBps: r.net_rx_bps,
      netTxBps: r.net_tx_bps,
      maxTempC: r.max_temp_c,
      powerWatts: r.power_watts,
      health: rank[r.health_rank] || 'unknown',
    })),
  };
}

/** حذف تاریخچهٔ قدیمی؛ در poller روزی یک‌بار صدا زده می‌شود. */
export function pruneServerMetrics(days = 30) {
  const keep = Math.max(1, Math.min(3650, Number(days) || 30));
  return db.prepare('DELETE FROM server_metrics WHERE ts < ?').run(Date.now() - keep * 86400 * 1000).changes;
}
