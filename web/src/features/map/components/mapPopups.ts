import { faDigits, statusMeta } from '../../../lib/format';
import type { MapMarker } from '../../../lib/types';
import { escapeHtml } from '../lib/markers';
import type { MapDevice, MapSite, SitePopupView } from '../model/types';

export function popupHtml(device: MapDevice) {
  const meta = statusMeta(device.status);
  return `
  <div style="min-width:220px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <strong style="font-size:13px;color:var(--nw-ink-800)">${escapeHtml(device.name)}</strong>
      <span style="font-size:10.5px;padding:2px 8px;border-radius:99px;background:${meta.chart}1a;color:${meta.chart};border:1px solid ${meta.chart}33">${meta.label}</span>
    </div>
    <div style="margin-top:8px;font-size:11.5px;color:var(--nw-ink-600);display:grid;gap:4px">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--nw-ink-400)">آدرس IP</span><span style="font-family:monospace">${escapeHtml(device.ip)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--nw-ink-400)">نوع تجهیز</span><span>${escapeHtml(device.deviceType)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--nw-ink-400)">گروه</span><span>${escapeHtml(device.groupName ?? '—')}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--nw-ink-400)">تأخیر</span><span>${device.lastRtt == null ? '—' : device.lastRtt.toFixed(1) + ' ms'}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--nw-ink-400)">موقعیت</span><span>${escapeHtml(device.location || '—')}</span></div>
    </div>
    <a href="/devices/${device.id}" style="display:block;margin-top:10px;text-align:center;font-size:11.5px;padding:6px;border-radius:10px;background:var(--nw-brand-50);color:var(--nw-accent);text-decoration:none">مشاهده صفحه تجهیز</a>
  </div>`;
}

/** پاپ‌آپ ایستگاه: فهرست تجهیزات عضو؛ هر ردیف با کلیک جزئیات را نشان می‌دهد. */
export function sitePopupHtml(site: MapSite) {
  const rows = site.devices
    .map((d) => {
      const meta = statusMeta(d.status);
      return `<button type="button" data-device-id="${d.id}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:6px 8px;border:1px solid var(--nw-ink-200);border-radius:9px;background:var(--nw-ink-50);cursor:pointer;text-align:right;font-family:inherit">
        <span style="display:flex;align-items:center;gap:6px;min-width:0">
          <span style="width:7px;height:7px;border-radius:99px;background:${meta.chart};flex:none"></span>
          <span style="font-size:11.5px;color:var(--nw-ink-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.name)}</span>
        </span>
        <span style="font-size:9.5px;color:${meta.chart};flex:none">${escapeHtml(meta.label)}</span>
      </button>`;
    })
    .join('');
  return `<div dir="rtl" style="min-width:230px;font-family:Vazirmatn,Tahoma,sans-serif">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <strong style="font-size:13px;color:var(--nw-ink-800)">${escapeHtml(site.name)}</strong>
      <span style="font-size:10px;padding:2px 8px;border-radius:99px;background:var(--nw-brand-50);color:var(--nw-accent);border:1px solid var(--nw-brand-200)">ایستگاه · ${faDigits(site.devices.length)} تجهیز</span>
    </div>
    <div style="margin-top:8px;display:grid;gap:4px;max-height:200px;overflow:auto">${rows || '<p style="font-size:11px;color:var(--nw-ink-400)">تجهیزی در این ایستگاه نیست</p>'}</div>
    <p style="margin-top:8px;font-size:10px;color:var(--nw-ink-400)">برای دیدن جزئیات، روی هر تجهیز کلیک کنید.</p>
  </div>`;
}

/**
 * سازندهٔ عنصر پاپ‌آپ ایستگاه.
 *
 * فهرست تجهیزات و جزئیات هر تجهیز هر دو در همین عنصر ساخته می‌شوند و جابه‌جایی
 * بین آن‌ها فقط با نمایش/مخفی کردن است. پیش‌تر محتوای پاپ‌آپ باز با
 * `setPopupContent` بازنویسی می‌شد و شنوندهٔ کلیک ردیف‌ها از بین می‌رفت؛ نتیجه
 * این بود که کلیک روی تجهیز، جزئیات را نشان نمی‌داد.
 */
export function sitePopupElement(site: MapSite): SitePopupView {
  const element = document.createElement('div');
  element.dir = 'rtl';

  const list = document.createElement('div');
  list.innerHTML = sitePopupHtml(site);

  const detail = document.createElement('div');
  detail.style.display = 'none';

  const showList = () => {
    detail.replaceChildren();
    detail.style.display = 'none';
    list.style.display = '';
  };
  const showDevice = (deviceId: number) => {
    const device = site.devices.find((d) => d.id === deviceId);
    if (!device) return;
    detail.replaceChildren(siteDeviceDetailElement(device, showList));
    list.style.display = 'none';
    detail.style.display = '';
  };

  for (const row of list.querySelectorAll<HTMLElement>('[data-device-id]')) {
    // جزئیات هر تجهیز درست مانند پاپ‌آپ همان تجهیز منفرد است.
    row.addEventListener('click', (event) => {
      event.preventDefault();
      const id = Number(row.dataset.deviceId);
      if (Number.isFinite(id)) showDevice(id);
    });
  }

  element.append(list, detail);
  return { element, showDevice, showList };
}

/** جزئیات تجهیز عضو ایستگاه با امکان بازگشت به فهرست ایستگاه */
export function siteDeviceDetailElement(device: MapDevice, onBack: () => void) {
  const element = document.createElement('div');
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'بازگشت به ایستگاه';
  back.style.cssText =
    'margin-bottom:6px;font-size:10.5px;color:var(--nw-accent);background:var(--nw-brand-50);border:1px solid var(--nw-brand-200);border-radius:8px;padding:3px 8px;cursor:pointer;font-family:inherit';
  back.addEventListener('click', (event) => {
    event.preventDefault();
    onBack();
  });
  const body = document.createElement('div');
  body.innerHTML = popupHtml(device);
  element.append(back, body);
  return element;
}

export function markerPopupHtml(m: MapMarker) {
  return `
  <div style="min-width:200px">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="display:inline-block;width:10px;height:10px;border-radius:99px;background:${m.typeColor || '#0ea5e9'}"></span>
      <strong style="font-size:13px;color:var(--nw-ink-800)">${escapeHtml(m.name)}</strong>
    </div>
    <div style="margin-top:8px;font-size:11.5px;color:var(--nw-ink-600);display:grid;gap:4px">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--nw-ink-400)">نوع</span><span>${escapeHtml(m.typeName ?? '—')}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--nw-ink-400)">عرض / طول</span><span style="font-family:monospace">${m.latitude.toFixed(5)}, ${m.longitude.toFixed(5)}</span></div>
      ${m.notes ? `<div style="color:var(--nw-ink-600)">${escapeHtml(m.notes)}</div>` : ''}
    </div>
  </div>`;
}
