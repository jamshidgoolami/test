/** ترتیب اهمیت کلاس‌های مکان برای جلوگیری از شلوغی برچسب‌ها. */
export const LABEL_ORDER: Record<string, number> = {
  continent: 0,
  country: 1,
  state: 2,
  province: 2,
  city: 3,
  town: 4,
  village: 5,
  hamlet: 6,
  isolated_dwelling: 7,
  suburb: 7,
  quarter: 7,
  neighbourhood: 8,
};

/** هر کلاس نام در چه بازهٔ زومی دیده می‌شود. */
export function labelVisible(cls: string, zoom: number) {
  switch (cls) {
    case 'country':
    case 'continent':
      return zoom <= 7.5;
    case 'state':
    case 'province':
      return zoom <= 8;
    case 'city':
      return zoom >= 4;
    case 'town':
      return zoom >= 7;
    case 'village':
      return zoom >= 10;
    case 'hamlet':
    case 'isolated_dwelling':
      return zoom >= 12;
    case 'suburb':
    case 'quarter':
    case 'neighbourhood':
      return zoom >= 12;
    default:
      return false;
  }
}

export function labelSize(cls: string, zoom: number) {
  if (cls === 'country' || cls === 'continent') return 15;
  if (cls === 'state' || cls === 'province') return 13;
  if (cls === 'city') return zoom >= 10 ? 15 : 13;
  if (cls === 'town') return 12.5;
  if (cls === 'village') return 11.5;
  return 11;
}

export function escapeLabel(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
