/**
 * پنل مشخصات — فقط یک انتخاب را نشان می‌دهد: تجهیز، شکل، یادداشت یا ارتباط.
 * در حالت نمایش فیلدها فقط‌خواندنی‌اند؛ در حالت ویرایش همان‌جا ویرایش می‌شوند.
 */
import React, { useState } from 'react';
import { Activity, ChevronDown, Circle, ExternalLink, Frame, Image as ImageIcon, MessageSquare, RefreshCw, Send, Square, StickyNote, Trash, Workflow } from 'lucide-react';
import { Field } from '../../components/ui';
import { ColorField } from '../../components/ColorField';
import { faDigits, fmtDateTime, fmtMs, fmtPct, fmtRelative, statusMeta } from '../../lib/format';
import { CONNECTION_TYPES, DEVICE_CATALOG, connectionType, deviceNodeNeedsSync, deviceType, newId } from '../../lib/diagrams';
import type { DiagramFlowEdge, DiagramFlowNode } from '../../lib/diagrams';
import { useAuth } from '../../lib/auth';
import type { Device, DiagramComment, DiagramDetail, DiagramEdgeData, DiagramNodeData, DiagramShape } from '../../lib/types';
import { DeviceGlyph } from './DeviceGlyph';

export interface DiagramInspectorProps {
  editing: boolean;
  diagram: DiagramDetail;
  nodes: DiagramFlowNode[];
  edges: DiagramFlowEdge[];
  node: DiagramFlowNode | null;
  edge: DiagramFlowEdge | null;
  onPatchData: (id: string, patch: Partial<DiagramNodeData>) => void;
  onPatchNode: (id: string, patch: { width?: number; height?: number }) => void;
  onPatchEdge: (id: string, patch: Partial<DiagramEdgeData>) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  /** رکورد تجهیز متصل به گرهٔ انتخاب‌شده (در صورت وجود) */
  device?: Device | null;
  /** همگام‌سازی گره با رکورد تجهیز */
  onSyncDevice?: (nodeId: string) => void;
  /** رفتن به صفحهٔ تجهیز */
  onOpenDevice?: (deviceId: number) => void;
  /** باز کردن پنجرهٔ پینگ زنده */
  onPingDevice?: (deviceId: number) => void;
  /** جایگزینی تصویر جزء نوع image */
  onReplaceImage?: (nodeId: string) => void;
  /** باز کردن دیاگرام مقصد یک جزء پیوند */
  onOpenDiagram?: (diagramId: number) => void;
  /** فهرست دیاگرام‌های قابل پیوند (برای تغییر مقصد) */
  diagrams?: { id: number; name: string }[];
}

function ReadRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-100 py-1.5 last:border-0">
      <span className="shrink-0 text-[11px] text-ink-400">{label}</span>
      <span className="min-w-0 text-left text-[11.5px] font-medium text-ink-700">{value || '—'}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">{title}</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

/**
 * کامنت‌های یک گره/لینک؛ در حالت نمایش فقط خوانده می‌شوند و در حالت ویرایش
 * می‌توان کامنت تازه ثبت کرد یا کامنت‌های قبلی را حذف کرد.
 */
function CommentsSection({
  comments = [],
  editing,
  onChange,
}: {
  comments?: DiagramComment[];
  editing: boolean;
  onChange: (comments: DiagramComment[]) => void;
}) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const safeComments = Array.isArray(comments) ? comments : [];
  const ordered = [...safeComments].sort((a, b) => b.createdAt - a.createdAt);

  const submit = () => {
    const value = text.trim();
    if (!value || !editing) return;
    onChange([
      ...safeComments,
      {
        id: newId(),
        text: value.slice(0, 1000),
        author: user?.displayName?.trim() || user?.username || 'کاربر',
        createdAt: Date.now(),
      },
    ]);
    setText('');
  };

  return (
    <Section title={`کامنت‌ها${safeComments.length ? ` (${faDigits(safeComments.length)})` : ''}`}>
      {ordered.length ? (
        <ul className="space-y-1.5">
          {ordered.map((comment) => (
            <li key={comment.id} className="rounded-soft border border-ink-100 bg-ink-50/60 p-2">
              <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
                <MessageSquare size={10} className="shrink-0" />
                <span className="min-w-0 truncate font-medium text-ink-600">{comment.author || 'کاربر'}</span>
                <span className="shrink-0">· {fmtRelative(comment.createdAt)}</span>
                {editing ? (
                  <button
                    type="button"
                    className="ms-auto shrink-0 rounded p-0.5 text-ink-400 transition hover:bg-surface hover:text-danger"
                    onClick={() => onChange(safeComments.filter((item) => item.id !== comment.id))}
                    title="حذف کامنت"
                    aria-label="حذف کامنت"
                  >
                    <Trash size={10} />
                  </button>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-5 text-ink-700">{comment.text}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-soft border border-dashed border-ink-200 p-2 text-[10.5px] leading-5 text-ink-400">
          هنوز کامنتی روی این مورد ثبت نشده است.
        </p>
      )}

      {editing ? (
        <div className="space-y-1.5">
          <textarea
            className="field min-h-16 resize-y"
            value={text}
            maxLength={1000}
            placeholder="یادداشت، هشدار یا نکتهٔ اجرایی…"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9.5px] text-ink-400">{faDigits(text.length)}/۱۰۰۰ · Ctrl+Enter</span>
            <button type="button" className="btn-primary btn-xs" onClick={submit} disabled={!text.trim()}>
              <Send size={11} />
              ثبت کامنت
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function SizeFields({
  width,
  height,
  editing,
  onResize,
}: {
  width: number;
  height: number;
  editing: boolean;
  onResize: (size: { width?: number; height?: number }) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="عرض (px)">
        <input
          type="number"
          min={60}
          max={2000}
          step={10}
          className="field"
          value={Math.round(width)}
          disabled={!editing}
          onChange={(e) => onResize({ width: Math.max(60, Math.min(2000, Number(e.target.value) || 60)) })}
        />
      </Field>
      <Field label="ارتفاع (px)">
        <input
          type="number"
          min={50}
          max={2000}
          step={10}
          className="field"
          value={Math.round(height)}
          disabled={!editing}
          onChange={(e) => onResize({ height: Math.max(50, Math.min(2000, Number(e.target.value) || 50)) })}
        />
      </Field>
    </div>
  );
}

export default function DiagramInspector({
  editing,
  diagram,
  nodes,
  edges,
  node,
  edge,
  onPatchData,
  onPatchNode,
  onPatchEdge,
  onDeleteNode,
  onDeleteEdge,
  device = null,
  onSyncDevice,
  onOpenDevice,
  onPingDevice,
  onReplaceImage,
  onOpenDiagram,
  diagrams = [],
}: DiagramInspectorProps) {
  if (edge) {
    const meta = connectionType(edge.data?.kind);
    const sourceLabel = nodes.find((n) => n.id === edge.source)?.data.label || 'جزء';
    const targetLabel = nodes.find((n) => n.id === edge.target)?.data.label || 'جزء';
    return (
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: `${meta.color}18`, color: meta.color }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink-800">ارتباط</p>
            <p className="truncate text-[10.5px] text-ink-400">
              {sourceLabel} ← {targetLabel}
            </p>
          </div>
        </div>

        <Section title="نوع ارتباط">
          <Field label="نوع">
            <select
              className="field"
              value={edge.data?.kind ?? 'copper'}
              disabled={!editing}
              onChange={(e) => onPatchEdge(edge.id, { kind: e.target.value as DiagramEdgeData['kind'] })}
            >
              {CONNECTION_TYPES.map((type) => (
                <option key={type.kind} value={type.kind}>
                  {type.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="rounded-soft border border-ink-100 bg-ink-50/60 p-2 text-[10.5px] leading-5 text-ink-500">
            برچسب متنی روی خط رسم نمی‌شود تا شبکه‌های شلوغ خوانا بمانند؛ نوع ارتباط فقط از رنگ و الگوی خط و
            راهنمای رنگ کنار بوم خوانده می‌شود. توضیح بیشتر را در کامنت‌های همین ارتباط بنویسید.
          </p>
        </Section>

        <Section title="نمایش">
          <div className="rounded-soft border border-ink-100 bg-ink-50/60 p-2">
            <div className="flex items-center gap-2 text-[11px] text-ink-600">
              <span className="h-0.5 w-10 shrink-0 rounded" style={{ background: meta.color }} />
              <span>{meta.label}</span>
            </div>
            <p className="mt-1 text-[10px] text-ink-400">رنگ و الگوی خط، نوع ارتباط را در بوم مشخص می‌کند.</p>
          </div>
        </Section>

        <CommentsSection
          comments={edge.data?.comments}
          editing={editing}
          onChange={(comments) => onPatchEdge(edge.id, { comments })}
        />

        {editing ? (
          <button type="button" className="btn-danger btn-xs mt-4 w-full" onClick={() => onDeleteEdge(edge.id)}>
            <Trash size={13} />
            حذف ارتباط
          </button>
        ) : null}
      </div>
    );
  }

  if (node) {
    const data = node.data;
    const isDevice = node.type === 'device';
    const isShape = node.type === 'shape';
    const isNote = node.type === 'note';
    const isGroup = node.type === 'group';
    const isImage = node.type === 'image';
    const isDiagram = node.type === 'diagram';
    const statusInfo = data.deviceId ? statusMeta(device?.status) : null;
    const needsSync = !!(device && deviceNodeNeedsSync(data, device));
    const meta = isDevice ? deviceType(data.deviceType) : null;
    const color = data.color || meta?.color || '#2563eb';
    const width = node.width ?? node.measured?.width ?? 190;
    const height = node.height ?? node.measured?.height ?? 86;

    return (
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
            style={{ background: `${color}18`, color }}
          >
            {isDevice && meta ? (
              <DeviceGlyph icon={meta.icon} size={16} />
            ) : isGroup ? (
              <Frame size={16} />
            ) : isShape ? (
              data.shape === 'circle' ? <Circle size={16} /> : <Square size={16} />
            ) : isImage ? (
              <ImageIcon size={16} />
            ) : isDiagram ? (
              <Workflow size={16} />
            ) : (
              <StickyNote size={16} />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink-800">
              {data.label || (isDevice ? 'تجهیز' : isGroup ? 'گروه' : isShape ? 'شکل' : isImage ? 'تصویر' : isDiagram ? 'پیوند دیاگرام' : 'یادداشت')}
            </p>
            <p className="truncate text-[10.5px] text-ink-400">
              {isDevice
                ? meta?.label
                : isGroup
                  ? 'کادر دسته‌بندی'
                  : isShape
                    ? data.shape === 'circle'
                      ? 'دایره'
                      : 'مستطیل'
                    : isImage
                      ? 'تصویر پیوست‌شده'
                      : isDiagram
                        ? 'پیوند به دیاگرام دیگر'
                        : 'یادداشت'}
            </p>
          </div>
        </div>

        {isDevice ? (
          <>
            <Section title="مشخصات تجهیز">
              {data.deviceId ? (
                <>
                  <ReadRow label="تجهیز مانیتورینگ" value={`#${faDigits(Number(data.deviceId))}`} />
                  <ReadRow
                    label="وضعیت زنده"
                    value={
                      statusInfo ? (
                        <span className={`inline-flex items-center gap-1 ${statusInfo.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dot}`} aria-hidden />
                          {statusInfo.label}
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <ReadRow
                    label="تأخیر / افت بسته"
                    value={`${fmtMs(device?.lastRtt)} · ${fmtPct(device?.lossPct, 0)}`}
                  />
                  <ReadRow label="آخرین بررسی" value={fmtRelative(device?.lastCheckAt)} />
                  {data.ip ? <ReadRow label="IP" value={<span className="ltr">{String(data.ip)}</span>} /> : null}
                  {data.syncedAt ? (
                    <ReadRow label="آخرین همگام‌سازی" value={fmtDateTime(Number(data.syncedAt))} />
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() => onOpenDevice?.(Number(data.deviceId))}
                      title="رفتن به صفحهٔ تجهیز"
                    >
                      <ExternalLink size={12} />
                      صفحهٔ تجهیز
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() => onPingDevice?.(Number(data.deviceId))}
                      title="باز کردن پنجرهٔ پینگ زنده"
                    >
                      <Activity size={12} />
                      پینگ زنده
                    </button>
                    {editing ? (
                      <button
                        type="button"
                        className={`btn-xs ${needsSync ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => onSyncDevice?.(node.id)}
                        disabled={!device}
                        title={
                          device
                            ? 'به‌روزرسانی نام/نوع/مدل/IP از رکورد تجهیز'
                            : 'این تجهیز در فهرست مانیتورینگ پیدا نشد.'
                        }
                      >
                        <RefreshCw size={12} />
                        همگام‌سازی
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="rounded-soft border border-dashed border-ink-200 p-2 text-[10.5px] leading-5 text-ink-400">
                  این گره به تجهیز مانیتورینگ متصل نیست؛ وضعیت زنده ندارد. برای اتصال، تجهیز را از تب «تجهیزات»
                  اضافه کنید.
                </p>
              )}
              <Field label="نام">
                <input
                  className="field"
                  value={String(data.label ?? '')}
                  disabled={!editing}
                  onChange={(e) => onPatchData(node.id, { label: e.target.value })}
                />
              </Field>
              <Field label="نوع تجهیز">
                <select
                  className="field"
                  value={data.deviceType || 'other'}
                  disabled={!editing}
                  onChange={(e) => {
                    const next = deviceType(e.target.value);
                    onPatchData(node.id, {
                      deviceType: next.key,
                      // اگر رنگ قبلی همان رنگ پیش‌فرض نوع قبلی بود، همراه آیکون تازه شود
                      ...(color === meta?.color ? { color: next.color } : {}),
                    });
                  }}
                >
                  {DEVICE_CATALOG.map((type) => (
                    <option key={type.key} value={type.key}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="مدل">
                <input
                  className="field"
                  value={String(data.model ?? '')}
                  disabled={!editing}
                  placeholder="مثلاً Catalyst 2960"
                  onChange={(e) => onPatchData(node.id, { model: e.target.value })}
                />
              </Field>
              <Field label="شماره سریال">
                <input
                  className="field ltr text-left"
                  value={String(data.serial ?? '')}
                  disabled={!editing}
                  onChange={(e) => onPatchData(node.id, { serial: e.target.value })}
                />
              </Field>
              <Field label="پلاک اموال">
                <input
                  className="field"
                  value={String(data.assetTag ?? '')}
                  disabled={!editing}
                  onChange={(e) => onPatchData(node.id, { assetTag: e.target.value })}
                />
              </Field>
              <Field label="توضیحات">
                <textarea
                  className="field min-h-20 resize-y"
                  value={String(data.description ?? '')}
                  disabled={!editing}
                  onChange={(e) => onPatchData(node.id, { description: e.target.value })}
                />
              </Field>
            </Section>
            <Section title="ظاهر و اندازه">
              <Field label="رنگ">
                <ColorField
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#2563eb'}
                  onChange={(next) => onPatchData(node.id, { color: next })}
                  disabled={!editing}
                />
              </Field>
              <SizeFields width={width} height={height} editing={editing} onResize={(size) => onPatchNode(node.id, size)} />
            </Section>
          </>
        ) : null}

        {isGroup ? (
          <>
            <Section title="گروه">
              <Field label="نام گروه" hint="این عنوان روی کادر گروه دیده می‌شود.">
                <input
                  className="field"
                  value={String(data.label ?? '')}
                  disabled={!editing}
                  placeholder="مثلاً طبقهٔ همکف"
                  onChange={(e) => onPatchData(node.id, { label: e.target.value })}
                />
              </Field>
              <Field label="توضیح (اختیاری)">
                <textarea
                  className="field min-h-16 resize-y"
                  value={String(data.text ?? '')}
                  disabled={!editing}
                  placeholder="محدودهٔ این گروه شامل چه تجهیزاتی است؟"
                  onChange={(e) => onPatchData(node.id, { text: e.target.value })}
                />
              </Field>
              <Field label="رنگ کادر">
                <ColorField
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#60a5fa'}
                  onChange={(next) => onPatchData(node.id, { color: next })}
                  disabled={!editing}
                />
              </Field>
              <SizeFields width={width} height={height} editing={editing} onResize={(size) => onPatchNode(node.id, size)} />
              <button
                type="button"
                className="btn-ghost btn-xs w-full"
                onClick={() => onPatchData(node.id, { collapsed: !data.collapsed })}
                disabled={!editing}
              >
                <ChevronDown size={12} className={data.collapsed ? 'rotate-180' : ''} />
                {data.collapsed ? 'باز کردن گروه' : 'جمع کردن گروه'}
              </button>
              <p className="text-[10.5px] leading-5 text-ink-400">
                کادر گروه پشت همهٔ تجهیزات و ارتباط‌ها نمایش داده می‌شود؛ برای دسته‌بندی، اجزای هر بخش را داخل آن قرار دهید.
                در حالت جمع‌شده، اجزای داخل کادر پنهان می‌شوند و با کلیک روی فلش گروه دوباره نمایش داده می‌شوند.
              </p>
            </Section>
          </>
        ) : null}

        {isShape ? (
          <>
            <Section title="شکل">
              <Field label="نوع شکل">
                <div className="grid grid-cols-2 gap-2">
                  {(['rect', 'circle'] as DiagramShape[]).map((shape) => (
                    <button
                      key={shape}
                      type="button"
                      disabled={!editing}
                      onClick={() => onPatchData(node.id, { shape })}
                      className={`flex items-center justify-center gap-1.5 rounded-soft border px-2 py-1.5 text-[11.5px] transition ${
                        data.shape === shape
                          ? 'border-brand-300 bg-brand-50 text-accent'
                          : 'border-ink-200 bg-surface text-ink-500 hover:border-ink-300'
                      }`}
                    >
                      {shape === 'circle' ? <Circle size={13} /> : <Square size={13} />}
                      {shape === 'circle' ? 'دایره' : 'مستطیل'}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="متن داخل شکل">
                <textarea
                  className="field min-h-20 resize-y"
                  value={String(data.text ?? '')}
                  disabled={!editing}
                  placeholder="متن دلخواه…"
                  onChange={(e) => onPatchData(node.id, { text: e.target.value })}
                />
              </Field>
              <Field label="رنگ">
                <ColorField
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#dbeafe'}
                  onChange={(next) => onPatchData(node.id, { color: next })}
                  disabled={!editing}
                />
              </Field>
              <SizeFields width={width} height={height} editing={editing} onResize={(size) => onPatchNode(node.id, size)} />
            </Section>
          </>
        ) : null}

        {isNote ? (
          <>
            <Section title="یادداشت">
              <Field label="عنوان">
                <input
                  className="field"
                  value={String(data.label ?? '')}
                  disabled={!editing}
                  onChange={(e) => onPatchData(node.id, { label: e.target.value })}
                />
              </Field>
              <Field label="متن یادداشت">
                <textarea
                  className="field min-h-28 resize-y"
                  value={String(data.text ?? '')}
                  disabled={!editing}
                  placeholder="توضیح، هشدار یا نکتهٔ اجرایی…"
                  onChange={(e) => onPatchData(node.id, { text: e.target.value })}
                />
              </Field>
              <Field label="رنگ کاغذ">
                <ColorField
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#fef08a'}
                  onChange={(next) => onPatchData(node.id, { color: next })}
                  disabled={!editing}
                />
              </Field>
              <SizeFields width={width} height={height} editing={editing} onResize={(size) => onPatchNode(node.id, size)} />
            </Section>
          </>
        ) : null}

        {isImage ? (
          <>
            <Section title="تصویر">
              <div className="overflow-hidden rounded-soft border border-ink-100 bg-ink-50">
                {data.src ? (
                  <img src={String(data.src)} alt="" className="max-h-40 w-full object-contain" />
                ) : (
                  <p className="p-4 text-center text-[11px] text-ink-400">تصویری پیوست نشده است.</p>
                )}
              </div>
              <Field label="توضیح زیر تصویر" hint="اختیاری — در برگهٔ خروجی زیر تصویر نمایش داده می‌شود.">
                <input
                  className="field"
                  value={String(data.caption ?? '')}
                  disabled={!editing}
                  placeholder="مثلاً نقشهٔ طبقهٔ همکف"
                  onChange={(e) => onPatchData(node.id, { caption: e.target.value, label: e.target.value || 'تصویر' })}
                />
              </Field>
              {editing ? (
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="btn-ghost btn-xs" onClick={() => onReplaceImage?.(node.id)}>
                    <ImageIcon size={12} />
                    جایگزینی تصویر
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-xs"
                    onClick={() => onPatchData(node.id, { src: '', attachmentId: 0, caption: '' })}
                    disabled={!data.src}
                  >
                    حذف تصویر
                  </button>
                </div>
              ) : null}
              <SizeFields width={width} height={height} editing={editing} onResize={(size) => onPatchNode(node.id, size)} />
            </Section>
          </>
        ) : null}

        {isDiagram ? (
          <>
            <Section title="پیوند دیاگرام">
              <Field
                label="دیاگرام مقصد"
                hint={editing ? 'مقصد پیوند را می‌توانید عوض کنید؛ مدیریت کامل در «نقشهٔ ارتباط» است.' : undefined}
              >
                <select
                  className="field"
                  value={data.diagramId ? String(data.diagramId) : ''}
                  disabled={!editing || diagrams.length === 0}
                  onChange={(e) => onPatchData(node.id, { diagramId: Number(e.target.value) })}
                >
                  <option value="" disabled>
                    انتخاب دیاگرام مقصد
                  </option>
                  {diagrams.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              {data.diagramId && !diagrams.some((item) => item.id === Number(data.diagramId)) ? (
                <p className="rounded-soft border border-sun-200 bg-sun-50 p-2 text-[10.5px] leading-5 text-warning">
                  دیاگرام مقصد حذف شده است؛ این پیوند در «نقشهٔ ارتباط» به‌عنوان پیوند شکسته نشان داده می‌شود.
                </p>
              ) : null}
              <Field label="نام نمایشی روی بوم">
                <input
                  className="field"
                  value={String(data.label ?? '')}
                  disabled={!editing}
                  placeholder="مثلاً مرکز مخابرات اول"
                  onChange={(e) => onPatchData(node.id, { label: e.target.value })}
                />
              </Field>
              <Field label="توضیح (اختیاری)" hint="توضیح کوتاهی از محدوده یا نقش دیاگرام مقصد">
                <textarea
                  className="field min-h-16 resize-y"
                  value={String(data.description ?? '')}
                  disabled={!editing}
                  onChange={(e) => onPatchData(node.id, { description: e.target.value })}
                />
              </Field>
              {data.diagramId ? (
                <button
                  type="button"
                  className="btn-ghost btn-xs"
                  onClick={() => onOpenDiagram?.(Number(data.diagramId))}
                  title="باز کردن دیاگرام مقصد"
                >
                  <ExternalLink size={12} />
                  باز کردن دیاگرام مقصد
                </button>
              ) : null}
              <p className="text-[10.5px] leading-5 text-ink-400">
                این جزء روی بوم، فایل دیگری را نمایندگی می‌کند؛ پیوند دوطرفه است و در دیاگرام مقصد هم جزء متناظر ساخته می‌شود. ارتباط بین دیاگرام‌ها در «نقشهٔ ارتباط» دیده می‌شود و با دوبار کلیک روی همین جزء، دیاگرام مقصد باز می‌شود.
              </p>
              <SizeFields width={width} height={height} editing={editing} onResize={(size) => onPatchNode(node.id, size)} />
            </Section>
          </>
        ) : null}

        <CommentsSection
          comments={data.comments}
          editing={editing}
          onChange={(comments) => onPatchData(node.id, { comments })}
        />

        {!editing ? (
          <div className="mt-4">
            <ReadRow label="موقعیت افقی" value={faDigits(Math.round(node.position.x))} />
            <ReadRow label="موقعیت عمودی" value={faDigits(Math.round(node.position.y))} />
          </div>
        ) : (
          <button type="button" className="btn-danger btn-xs mt-4 w-full" onClick={() => onDeleteNode(node.id)}>
            <Trash size={13} />
            حذف از بوم
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="rounded-soft border border-ink-100 bg-ink-50/60 p-3">
        <p className="text-[12.5px] font-semibold text-ink-800">{diagram.name}</p>
        {diagram.description ? (
          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-ink-500">{diagram.description}</p>
        ) : null}
      </div>
      <Section title="اطلاعات دیاگرام">
        <ReadRow label="اجزا" value={faDigits(nodes.length)} />
        <ReadRow label="ارتباط‌ها" value={faDigits(edges.length)} />
        <ReadRow label="نسخه" value={faDigits(diagram.revision)} />
        <ReadRow label="آخرین ذخیره" value={fmtDateTime(diagram.updatedAt)} />
        {diagram.parentId ? <ReadRow label="دیاگرام والد" value={`#${faDigits(diagram.parentId)}`} /> : null}
      </Section>
      <p className="mt-4 rounded-soft border border-dashed border-ink-200 p-2.5 text-[10.5px] leading-5 text-ink-400">
        برای دیدن مشخصات، روی یک تجهیز، شکل، یادداشت یا خط ارتباط کلیک کنید. برای تغییر نام و ساخت زیرمجموعه، از
        فهرست دیاگرام‌ها استفاده کنید.
      </p>
    </div>
  );
}
