/**
 * NetWatch — حلقهٔ خودزمان‌بند موتور.
 * پس از هر بررسی، گام بعدی زمان‌بندی می‌شود؛ در حالت اشباع، refill کوتاه اجرا
 * می‌شود تا ظرفیت آزادشده بلافاصله پر شود. timer و چرخهٔ حیات در موتور می‌مانند.
 */
const REFILL_DELAY_MS = 5;

export function startLoop(engine) {
  engine._loopActive = true;
  scheduleLoop(engine, 0);
}

/** اگر تایمری از قبل در انتظار است، دوباره ساخته نمی‌شود. */
export function scheduleLoop(engine, delayMs) {
  if (!engine.running || !engine._loopActive || engine.timer || engine._loopBusy) return;
  engine.timer = setTimeout(
    () => {
      engine.timer = null;
      runLoopStep(engine);
    },
    Math.max(0, delayMs)
  );
  if (engine.timer.unref) engine.timer.unref();
}

export function runLoopStep(engine) {
  if (!engine.running || !engine._loopActive) return;
  engine._loopBusy = true;
  // tick تا نخستین await به‌صورت همگام اجرا می‌شود، پس تعداد شروع‌شده فوراً در دسترس است.
  const task = engine.tick();
  const launched = Number(engine.stats.lastTickLaunched) || 0;
  const capacity = Number(engine.stats.lastTickCapacity) || 0;
  engine._saturated = capacity > 0 && launched >= capacity;
  engine._loopBusy = false;
  task.catch((e) => engine.noteInternalError(e, { phase: 'tick' }));
  scheduleLoop(engine, engine._saturated ? REFILL_DELAY_MS : engine.interval);
}

/** آزادشدن ظرفیت در حالت اشباع، گام بعدی را تقریباً فوری زمان‌بندی می‌کند. */
export function notifyCapacityFreed(engine) {
  if (!engine.running || !engine._loopActive || !engine._saturated) return;
  const now = Date.now();
  if (now - engine._lastRefillAt < REFILL_DELAY_MS) {
    scheduleLoop(engine, REFILL_DELAY_MS);
    return;
  }
  engine._lastRefillAt = now;
  scheduleLoop(engine, REFILL_DELAY_MS);
}
