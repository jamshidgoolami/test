/**
 * NetWatch — صف کوتاه ثبت نتایج بررسی
 * ----------------------------------------------------------------
 * چند نتیجهٔ Probe در یک تراکنش COMMIT می‌شوند؛ هر مورد با SAVEPOINT
 * مستقل اجرا می‌شود تا شکست یک تجهیز بقیه را باطل نکند.
 */
export class RecordBatcher {
  constructor({ transaction, maxBatch = 128, flushMs = 4 }) {
    this.transaction = transaction;
    this.maxBatch = maxBatch;
    this.flushMs = flushMs;
    this.queue = [];
    this.timer = null;
  }

  enqueue(fn, label) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, label, resolve, reject });
      if (this.queue.length >= this.maxBatch) {
        this.flush();
        return;
      }
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush();
        }, this.flushMs);
        // این تایمر نباید unref شود: تا زمانی که نتیجه‌ای در صف نوشتن است،
        // کار واقعی در جریان است و فرآیند نباید پیش از ثبت آن خارج شود.
      }
    });
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, this.queue.length);
    const outcomes = [];
    try {
      this.transaction(
        () => {
          for (const item of batch) {
            try {
              outcomes.push({ ok: true, value: this.transaction(item.fn, { label: item.label }) });
            } catch (e) {
              outcomes.push({ ok: false, error: e });
            }
          }
        },
        { label: 'engine.record.batch' }
      );
    } catch (e) {
      for (const item of batch) item.reject(e);
      return;
    }
    for (let i = 0; i < batch.length; i++) {
      const outcome = outcomes[i];
      if (outcome?.ok) batch[i].resolve(outcome.value);
      else batch[i].reject(outcome?.error || new Error('ثبت نتیجهٔ بررسی انجام نشد.'));
    }
  }
}
