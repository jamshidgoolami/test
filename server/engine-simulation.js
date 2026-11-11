/**
 * NetWatch — شبیه‌ساز بررسی شبکه
 * ----------------------------------------------------------------
 * فقط برای دمو/آموزش. هیچ نمونهٔ تولیدشده در این ماژول ادعای دادهٔ واقعی
 * نمی‌کند و برچسب mode=simulate دارد.
 */

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ */
/* قالب پرس‌وجوهای آماده                                               */

const simState = new Map();
function simProfile(device) {
  let s = simState.get(device.id);
  if (!s) {
    const r1 = hash(`${device.ip}:a`);
    const r2 = hash(`${device.ip}:b`);
    const r3 = hash(`${device.ip}:c`);
    const base = r1 > 0.93 ? 120 + r1 * 160 : 2 + r1 * 55;
    // «chronic»: تجهیزات دارای خرابی پایدار (بازتاب واقعی شبکه‌هایی که تجهیز معیوب در انتظار تعمیر دارند)
    const chronic = r3 > 0.93;
    s = {
      base,
      drift: 0,
      jitter: 1 + r2 * 14,
      lossProb: chronic ? 0.35 : r3 > 0.82 ? 0.16 + r3 * 0.25 : r3 * 0.03,
      outageChance: chronic ? 0.22 : r3 > 0.6 ? 0.01 : 0.0025,
      chronic,
      downTicks: chronic ? 45 + Math.floor(r1 * 120) : 0,
    };
    simState.set(device.id, s);
  }
  return s;
}

const DOWN_RESULT = (count) => ({
  ok: false,
  reachable: false,
  service: 'unknown',
  servicePort: null,
  rtt: null,
  packetsSent: count,
  packetsRecv: 0,
  lossPct: 100,
  mode: 'simulate',
  error: 'TIMEOUT',
});

function simulateCheck(device, count) {
  const s = simProfile(device);
  if (s.downTicks > 0) {
    s.downTicks--;
    return DOWN_RESULT(count);
  }
  if (Math.random() < s.outageChance) {
    s.downTicks = s.chronic ? 40 + Math.floor(Math.random() * 90) : 1 + Math.floor(Math.random() * 8);
    return DOWN_RESULT(count);
  }

  s.drift = s.drift * 0.9 + (Math.random() - 0.5) * s.jitter * 0.6;
  const rtt = Math.max(0.3, s.base + s.drift + (Math.random() - 0.5) * s.jitter);
  let recv = count;
  if (Math.random() < s.lossProb) recv = Math.max(0, count - (1 + Math.floor(Math.random() * (count - 1 || 1))));
  const lossPct = Math.round(((count - recv) / count) * 1000) / 10;
  return {
    ok: recv > 0,
    reachable: recv > 0,
    // دادهٔ شبیه‌سازی‌شده هرگز ادعای «سرویس سالم» نمی‌کند؛ فقط دسترسی شبکه.
    service: 'unknown',
    servicePort: null,
    rtt: Math.round(rtt * 100) / 100,
    packetsSent: count,
    packetsRecv: recv,
    lossPct,
    mode: 'simulate',
    error: recv > 0 ? undefined : 'TIMEOUT',
  };
}

/* ------------------------------------------------------------------ */

export function clearSimulationCache() {
  simState.clear();
}

export { simulateCheck };
