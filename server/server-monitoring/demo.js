/**
 * NetWatch — منبع نمایشی سرور
 * ----------------------------------------------------------------
 * برای آزمون رابط، دموی فروش و توسعهٔ بدون دسترسی به BMC/ویندوز. داده‌ها
 * قطعاً مصنوعی‌اند و در UI با برچسب «نمایشی» نمایش داده می‌شوند.
 */
const GIB = 1024 ** 3;

export function demoSnapshot(profile, now = Date.now()) {
  const phase = (now / 1000 + Number(profile.id || 1) * 37) % 3600;
  const wave = (period, min, max) => min + (max - min) * (0.5 + 0.5 * Math.sin(phase / period));
  const cpu = Math.round(wave(420, 12, 78) * 10) / 10;
  const memTotal = 256 * GIB;
  const memPct = Math.round(wave(900, 38, 76) * 10) / 10;
  const memUsed = Math.round((memTotal * memPct) / 100);
  const netRx = Math.round(wave(180, 4_000_000, 90_000_000));
  const netTx = Math.round(wave(230, 2_000_000, 55_000_000));
  const temps = {
    cpu1: Math.round(wave(500, 38, 67) * 10) / 10,
    cpu2: Math.round(wave(540, 36, 65) * 10) / 10,
    inlet: Math.round(wave(1200, 21, 29) * 10) / 10,
  };
  const maxTemp = Math.max(temps.cpu1, temps.cpu2, temps.inlet);
  const diskUsed = [42, 67, 81, 55];
  const diskTotal = 1.92 * 1024 ** 4;
  const volumes = diskUsed.map((used, i) => ({
    diskKey: `demo:volume-${i + 1}`,
    source: 'demo',
    kind: 'volume',
    name: `Volume ${String.fromCharCode(67 + i)}:`,
    mount: `${String.fromCharCode(67 + i)}:`,
    filesystem: 'NTFS',
    totalBytes: diskTotal,
    freeBytes: diskTotal * (1 - used / 100),
    usedPct: used,
    health: 'ok',
    temperatureC: null,
    wearPct: null,
    readErrors: null,
    writeErrors: null,
    powerOnHours: null,
  }));
  const drives = Array.from({ length: 4 }, (_, i) => ({
    diskKey: `demo:bay-${i + 1}`,
    source: 'demo',
    kind: 'physical',
    name: `NVMe Bay ${i + 1}`,
    mount: '',
    filesystem: '',
    totalBytes: diskTotal,
    freeBytes: null,
    usedPct: null,
    health: i === 3 ? 'warning' : 'ok',
    temperatureC: Math.round((36 + i * 2 + wave(300, 0, 4)) * 10) / 10,
    wearPct: 7 + i * 3,
    readErrors: 0,
    writeErrors: i === 3 ? 2 : 0,
    powerOnHours: 8200 + i * 1100,
  }));
  const sensors = [
    { sensorKey: 'demo:CPU1Temp', source: 'demo', name: 'CPU1 Temp', type: 'temperature', reading: temps.cpu1, unit: 'C', status: temps.cpu1 > 80 ? 'warning' : 'ok' },
    { sensorKey: 'demo:CPU2Temp', source: 'demo', name: 'CPU2 Temp', type: 'temperature', reading: temps.cpu2, unit: 'C', status: temps.cpu2 > 80 ? 'warning' : 'ok' },
    { sensorKey: 'demo:InletTemp', source: 'demo', name: 'Inlet Temp', type: 'temperature', reading: temps.inlet, unit: 'C', status: 'ok' },
    { sensorKey: 'demo:FAN1', source: 'demo', name: 'FAN1', type: 'fan', reading: Math.round(wave(90, 4200, 7200)), unit: 'RPM', status: 'ok' },
    { sensorKey: 'demo:PSU1', source: 'demo', name: 'PSU1 Power', type: 'power', reading: Math.round(wave(310, 180, 360)), unit: 'W', status: 'ok' },
  ];
  return {
    collectedAt: now,
    metric: {
      source: 'demo',
      cpuPct: cpu,
      memTotalBytes: memTotal,
      memUsedBytes: memUsed,
      memPct,
      diskTotalBytes: diskTotal * volumes.length,
      diskUsedBytes: volumes.reduce((sum, d) => sum + d.totalBytes * (d.usedPct / 100), 0),
      diskMaxPct: Math.max(...diskUsed),
      netRxBps: netRx,
      netTxBps: netTx,
      netRxErrors: 0,
      netTxErrors: 0,
      maxTempC: maxTemp,
      powerWatts: Math.round(wave(310, 180, 360)),
      uptimeSec: 60 * 60 * 24 * 37 + Math.floor(phase),
      health: drives.some((d) => d.health !== 'ok') ? 'warning' : 'ok',
    },
    disks: [...volumes, ...drives],
    nics: [
      {
        nicKey: 'demo:nic1',
        source: 'demo',
        name: '10GbE Management',
        mac: '00:25:90:AA:01:10',
        speedBps: 10_000_000_000,
        rxBps: netRx,
        txBps: netTx,
        rxErrors: 0,
        txErrors: 0,
        linkStatus: 'up',
      },
      {
        nicKey: 'demo:nic2',
        source: 'demo',
        name: '10GbE Data',
        mac: '00:25:90:AA:01:11',
        speedBps: 10_000_000_000,
        rxBps: Math.round(netRx * 0.7),
        txBps: Math.round(netTx * 0.8),
        rxErrors: 0,
        txErrors: 0,
        linkStatus: 'up',
      },
    ],
    sensors,
    inventory: {
      manufacturer: 'Supermicro',
      model: 'SYS-620U-TNR',
      serial: `DEMO-${String(profile.id).padStart(4, '0')}`,
      biosVersion: '3.5',
      bmcFirmware: '01.03.12',
      cpuModel: 'Intel Xeon Silver 4314',
      cpuCores: 32,
      cpuThreads: 64,
      memoryTotalBytes: memTotal,
      dimmCount: 8,
      psuCount: 2,
      osName: 'Microsoft Windows Server 2022 Standard',
      osVersion: '10.0.20348',
      raw: { demo: true },
    },
    raw: { demo: true },
  };
}
