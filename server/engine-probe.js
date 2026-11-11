/**
 * NetWatch — اجرای Probe و مهلت سخت
 * ----------------------------------------------------------------
 * انتخاب پروتکل، Retry داخلی Probe و سقف زمانی کل بررسی در این ماژول
 * نگه داشته می‌شود؛ ثبت نتیجه و گذار وضعیت همچنان در موتور است.
 */
import { icmpPing, icmpStatus, tcpPing } from './ping.js';
import { simulateCheck } from './engine-simulation.js';

function bounded(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function runProbe(device, { timeoutMs, count, retries, mode, port, signal = null }) {
  const attempts = Math.max(1, (retries || 0) + 1);
  const tcpPort = Number(port) || 80;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) {
      return {
        ok: false,
        reachable: false,
        rtt: null,
        packetsSent: 0,
        packetsRecv: 0,
        lossPct: 100,
        mode: 'cancelled',
        error: 'CANCELLED',
        service: 'unknown',
        servicePort: null,
      };
    }
    const effective = mode === 'auto' ? (icmpStatus() === false ? 'tcp' : 'icmp') : mode;
    last =
      effective === 'simulate'
        ? simulateCheck(device, count)
        : effective === 'tcp'
          ? await tcpPing(device.ip, { timeoutMs, count: Math.min(count, 3), port: tcpPort, signal })
          : await icmpPing(device.ip, { timeoutMs, count, signal });
    if (last.ok) return last;
    // اگر ICMP به دلیل مجوزها مسدود است، به TCP سقوط کن
    if (last.error === 'ICMP_BLOCKED') {
      last = await tcpPing(device.ip, { timeoutMs, count: Math.min(count, 3), port: tcpPort, signal });
      if (last.ok) return last;
    }
    if (signal?.aborted) break;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 200));
  }
  return last;
}

/**
 * اجرای پروب با مهلت سخت مستقل از لایهٔ پروب. اگر لایهٔ پایین به هر دلیلی
 * برنگردد، این مهلت جای ظرفیت موتور را با یک بررسی آویزان اشغال نمی‌کند.
 */
export async function probeWithDeadline(probe, device, options, deadlineOverride = null) {
  const attempts = Math.max(1, (options.retries || 0) + 1);
  const perAttempt = Math.max(500, options.timeoutMs * options.count + 2500);
  const deadlineMs = bounded(deadlineOverride ?? attempts * perAttempt + 2000, 50, 5 * 60 * 1000, 30000);
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`پروب از مهلت سخت ${deadlineMs} میلی‌ثانیه‌ای گذشت`);
      err.code = 'PROBE_DEADLINE';
      reject(err);
    }, deadlineMs);
    if (timer.unref) timer.unref();
  });
  try {
    return await Promise.race([probe(device, options), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function guessCause(result, failures) {
  if (result.error === 'TIMEOUT' || result.error === 'HARD_TIMEOUT') return 'Ping Timeout';
  if (result.error === 'SERVICE_UNAVAILABLE') return 'سرویس روی پورت مورد پایش پاسخ نمی‌دهد';
  if (result.error === 'ECONNREFUSED') return 'مشکل شبکه';
  if (result.error === 'EHOSTUNREACH' || result.error === 'ENETUNREACH') return 'اختلال در زیرساخت فیبر نوری';
  if (failures >= 10) return 'هنگ کردن سوئیچ';
  return 'مشکل شبکه';
}
