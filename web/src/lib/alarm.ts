/**
 * NetWatch — صدای اژیر هشدار سرور
 * ----------------------------------------------------------------
 * صدا با Web Audio ساخته می‌شود؛ فایل صوتی اضافه‌ای لازم نیست. مرورگرها
 * پخش صدا پیش از اولین تعامل کاربر را مسدود می‌کنند، بنابراین AudioContext
 * با اولین کلیک/لمس/کلید باز و resume می‌شود. اگر پخش هنوز ممکن نباشد،
 * `false` برگردانده می‌شود تا App بتواند یک راهنمای کوتاه نشان دهد.
 */
let audioContext: AudioContext | null = null;
let activeUntil = 0;
let pendingSiren: 'info' | 'warning' | 'critical' | null = null;

type AudioContextCtor = new () => AudioContext;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioContext) return audioContext;
  const ctor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!ctor) return null;
  try {
    audioContext = new ctor();
    return audioContext;
  } catch {
    return null;
  }
}

/** باید از داخل یک رویداد کاربر (click/pointerdown/keydown) صدا زده شود. */
export function unlockAlarm(): void {
  const context = getContext();
  if (!context) return;
  const pending = pendingSiren;
  pendingSiren = null;
  if (context.state === 'suspended') {
    void context.resume().then(() => {
      if (pending) playSiren(pending);
    });
  } else if (pending) {
    playSiren(pending);
  }
}

/** یک‌بار در شروع برنامه نصب می‌شود؛ اولین تعامل، قفل Autoplay را باز می‌کند. */
export function primeAlarmOnInteraction(): () => void {
  if (typeof window === 'undefined') return () => {};
  const unlock = () => unlockAlarm();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
  return () => {
    window.removeEventListener('pointerdown', unlock, { capture: true });
    window.removeEventListener('keydown', unlock, { capture: true });
  };
}

/**
 * یک اژیر کوتاه و تکرارشونده پخش می‌کند. برای warning دو چرخه و برای
 * critical سه چرخه؛ صدا از بلندی ۵۲۰Hz به ۱۰۵۰Hz و برگشت حرکت می‌کند.
 */
export function playSiren(severity: 'info' | 'warning' | 'critical' = 'warning'): boolean {
  const context = getContext();
  if (!context) return false;
  if (context.state === 'suspended') {
    // درخواست resume فقط پس از تعامل کاربر نتیجه می‌دهد؛ اژیر را نگه می‌داریم
    // تا نخستین کلیک/کلید همان هشدار را پخش کند، نه هشدار بعدی.
    pendingSiren = severity;
    void context.resume().then(() => {
      if (pendingSiren && context.state === 'running') {
        const queued = pendingSiren;
        pendingSiren = null;
        playSiren(queued);
      }
    });
    return false;
  }
  const nowMs = Date.now();
  if (nowMs < activeUntil) return true;

  const cycles = severity === 'critical' ? 3 : 2;
  const cycleSec = 0.78;
  const duration = cycles * cycleSec;
  const start = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(520, start);
  for (let i = 0; i < cycles; i += 1) {
    const t = start + i * cycleSec;
    oscillator.frequency.linearRampToValueAtTime(1050, t + 0.34);
    oscillator.frequency.linearRampToValueAtTime(520, t + 0.68);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.1, start + 0.035);
  gain.gain.setValueAtTime(0.1, start + duration - 0.1);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
  activeUntil = nowMs + duration * 1000;
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  return true;
}

/** برای تست/آزمایش دستی؛ وضعیت قفل صوتی را برمی‌گرداند. */
export function alarmState(): 'unsupported' | 'suspended' | 'ready' {
  const context = getContext();
  if (!context) return 'unsupported';
  return context.state === 'suspended' ? 'suspended' : 'ready';
}
