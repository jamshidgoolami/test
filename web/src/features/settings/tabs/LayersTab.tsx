import { useRef, useState } from 'react';
import { Check, Map as MapIcon, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import { api } from '../../../lib/api';
import { useApp, useAsync, useToast } from '../../../lib/store';

import { faDigits } from '../../../lib/format';
import { Badge, Card, CardHeader, EmptyState } from '../../../components/ui';

export function LayersTab() {
  const { push } = useToast();
  const { refreshMeta } = useApp();
  const { data, refresh } = useAsync((signal) => api.layers(signal), []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // فقط نقشه‌های بارگذاری‌شدهٔ کاربر (MBTiles) در این بخش مدیریت می‌شوند؛
  // لایه‌های داخلی و لایه‌های خالی دسته‌بندی در این فهرست نمی‌آیند.
  const maps = (data?.items ?? []).filter((l) => l.kind === 'mbtiles' && l.file_name);

  const upload = async (file: File) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.uploadLayer(file, name || undefined);
      push(`نقشهٔ «${res.layer.name}» با ${faDigits(res.info.tileCount ?? 0)} کاشی بارگذاری شد`, 'success');
      setName('');
      refresh();
      refreshMeta();
    } catch (e) {
      push((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  /** انتخاب نقشهٔ پایه: در هر لحظه فقط یک نقشه فعال می‌شود. */
  const selectMap = async (id: number) => {
    try {
      await Promise.all((data?.items ?? []).map((l) => api.updateLayer(l.id, { visible: l.id === id ? 1 : 0 })));
      refresh();
      refreshMeta();
    } catch (e) {
      push((e as Error).message, 'error');
    }
  };

  return (
    <Card>
      <CardHeader
        title="مدیریت و بارگذاری نقشه"
        subtitle="نقشه‌های آفلاین MBTiles — بارگذاری، انتخاب نقشهٔ فعال و حذف"
        icon={<MapIcon size={18} />}
        action={
          <button type="button" className="btn-ghost btn-xs" onClick={refresh}>
            <RefreshCw size={13} />
            به‌روزرسانی
          </button>
        }
      />

      <div className="mt-4 rounded-soft border border-brand-100 bg-brand-50/50 p-4">
        <p className="text-[12.5px] font-medium text-accent">بارگذاری نقشهٔ جدید (.mbtiles)</p>
        <p className="mt-1 text-[11px] text-accent/80">
          کاشی‌های تصویری (PNG/JPEG) با Leaflet و کاشی‌های برداری (PBF/MVT) با MapLibre نمایش داده می‌شوند؛ نیازی به
          اینترنت نیست.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="field !w-auto flex-1"
            placeholder="نام نمایشی نقشه (اختیاری)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".mbtiles"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.currentTarget.value = '';
            }}
          />
          <button type="button" className="btn-primary btn-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={14} />
            {busy ? 'در حال بارگذاری…' : 'انتخاب فایل MBTiles'}
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {maps.length === 0 ? (
          <EmptyState
            title="نقشه‌ای بارگذاری نشده است"
            description="برای نمایش نقشهٔ پایه، یک فایل MBTiles بارگذاری کنید."
            icon={<MapIcon size={22} />}
          />
        ) : null}
        {maps.map((l) => {
          const active = !!l.visible;
          return (
            <div
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-soft border border-ink-200 bg-surface/70 p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-700">
                  <span className="truncate">{l.name}</span>
                  {l.is_default ? <Badge tone="brand">پیش‌فرض</Badge> : null}
                  {active ? <Badge tone="emerald">فعال</Badge> : null}
                </p>
                <p className="num mt-1 text-[10.5px] text-ink-400">
                  {l.file_name} · {faDigits(l.tile_count ?? 0)} کاشی · زوم {faDigits(l.min_zoom)} تا{' '}
                  {faDigits(l.max_zoom)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`btn-xs ${active ? 'btn-soft' : 'btn-ghost'}`}
                  onClick={() => selectMap(l.id)}
                  disabled={active}
                  title={active ? 'این نقشه روی صفحهٔ نقشه فعال است' : 'استفاده به‌عنوان نقشهٔ پایه'}
                >
                  <Check size={13} />
                  {active ? 'نقشهٔ فعال' : 'انتخاب'}
                </button>
                {!l.is_default ? (
                  <button
                    type="button"
                    className="btn-ghost btn-xs"
                    onClick={async () => {
                      await api.updateLayer(l.id, { is_default: 1 });
                      refresh();
                      refreshMeta();
                      push('نقشه پیش‌فرض تغییر کرد', 'success');
                    }}
                  >
                    <Save size={13} />
                    پیش‌فرض
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-danger btn-xs"
                  onClick={async () => {
                    if (!window.confirm(`نقشه «${l.name}» و فایل آن حذف شود؟`)) return;
                    try {
                      await api.deleteLayer(l.id, true);
                      refresh();
                      refreshMeta();
                      push('نقشه حذف شد', 'success');
                    } catch (e) {
                      push((e as Error).message, 'error');
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 rounded-soft border border-ink-200 bg-surface/70 p-3 text-[11.5px] leading-relaxed text-ink-500">
        فایل‌های{' '}
        <span className="num" dir="ltr">
          .mbtiles
        </span>{' '}
        در پوشه{' '}
        <span className="num" dir="ltr">
          data/mbtiles
        </span>{' '}
        نگهداری و کاشی‌ها از طریق مسیر{' '}
        <span className="num" dir="ltr">
          /api/tiles/&lt;layerId&gt;/z/x/y
        </span>{' '}
        سرو می‌شوند؛ بدون نیاز به هیچ سرویس نقشه آنلاین.
      </p>
    </Card>
  );
}
