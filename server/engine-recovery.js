/**
 * NetWatch — بازیابی سازگاری وضعیت تجهیزات و قطعی‌ها پس از Start/Recovery.
 * این ماژول وضعیت تجهیز را Online/Offline نمی‌کند؛ فقط ارجاع‌های شکسته و
 * قطعی‌های باز ناسازگار را اصلاح می‌کند.
 */
export function recoverState({ transaction, statements, db, now = Date.now() }) {
  return transaction(
    () => {
      const report = { adopted: 0, dangling: 0, duplicates: 0, reopened: 0 };
      for (const row of statements.orphans.all()) {
        // سایر قطعی‌های باز همین تجهیز بسته می‌شوند و تنها همین یک ردیف می‌ماند
        statements.closeOpenOutages.run(now, now, row.device_id, row.id);
        statements.adoptOutage.run(row.id, row.started_at, row.device_id);
        report.adopted++;
      }
      report.dangling = Number(statements.danglingRefs.all().length) || 0;
      statements.clearDanglingOutage.run();
      for (const d of statements.offlineWithoutOutage.all()) {
        const res = statements.openOutage.run(d.id, now, null, null, d.status_reason || 'Ping Timeout', '', null, null);
        db.prepare('UPDATE devices SET current_outage_id = ?, current_outage_started_at = ? WHERE id = ?').run(
          Number(res.lastInsertRowid),
          now,
          d.id
        );
        report.reopened++;
      }
      return report;
    },
    { label: 'engine.recover' }
  );
}
