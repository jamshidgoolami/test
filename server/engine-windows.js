/**
 * NetWatch — پنجرهٔ تعمیرات و ساعات سکوت.
 */
export function inMaintenanceWindow(rows, deviceId, now = new Date()) {
  if (!rows.length) return false;
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const w of rows) {
    if (w.device_id && w.device_id !== deviceId) continue;
    const days = String(w.days || '')
      .split(',')
      .map((x) => Number(x.trim()));
    if (!days.includes(day)) continue;
    const [sh, sm] = String(w.start_time || '00:00')
      .split(':')
      .map(Number);
    const [eh, em] = String(w.end_time || '00:00')
      .split(':')
      .map(Number);
    const start = sh * 60 + (sm || 0);
    const end = eh * 60 + (em || 0);
    if (start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end) return true;
  }
  return false;
}

export function inQuietHours(settings, now = new Date()) {
  if (!settings.suppression_enabled) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = String(settings.suppression_start).split(':').map(Number);
  const [eh, em] = String(settings.suppression_end).split(':').map(Number);
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  return start <= end ? minutes >= start && minutes <= end : minutes >= start || minutes <= end;
}
