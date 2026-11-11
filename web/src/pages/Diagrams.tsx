/**
 * دیاگرام‌های شبکه — هر دیاگرام یک فایل مستقل با بوم اختصاصی است.
 *
 * چیدمان: نوار بالای صفحه (نام، حالت نمایش/ویرایش، خروجی، ذخیره)، نوار
 * ابزار بوم (فقط در ویرایش) و پنل کناری تاشو (دیاگرام‌ها / تجهیزات /
 * مشخصات انتخاب). بوم بیشترین فضا را می‌گیرد و دکمهٔ بستن پنل روی خود پنل
 * است؛ پس از بسته شدن، دکمهٔ باز کردن در نوار بالا ظاهر می‌شود.
 *
 * ویرایش: همهٔ تغییرات از `useCanvasHistory` عبور می‌کنند تا واگرد/ازنو داشته
 * باشند؛ کشیدن و تغییر اندازه یک گام می‌سازند. ذخیرهٔ خودکار با تأخیر کوتاه
 * انجام می‌شود و ذخیرهٔ دستی (Ctrl+S) همیشه در دسترس است.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { AlertCircle, ArrowRight, ChevronLeft, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApp, useAsync, useToast } from '../lib/store';
import { faDigits } from '../lib/format';
import type { Device, DiagramGraph, DiagramShape, DiagramSummary } from '../lib/types';
import { EmptyState, PageLoader } from '../components/ui';
import { useLivePing } from '../components/LivePing';
import DiagramCanvas from '../features/diagrams/DiagramCanvas';
import type { DiagramCanvasHandle, DiagramExportFormat } from '../features/diagrams/DiagramCanvas';
import DiagramDevicePalette from '../features/diagrams/DiagramDevicePalette';
import DiagramToolbar from '../features/diagrams/DiagramToolbar';
import DiagramInspector from '../features/diagrams/DiagramInspector';
import DiagramTree from '../features/diagrams/DiagramTree';
import DiagramOverview from '../features/diagrams/DiagramOverview';
import { useCanvasHistory } from '../features/diagrams/useCanvasHistory';

import { useDiagramPreferences, isTypingTarget } from '../features/diagrams/editor/preferences';
import type { EditorDialog, Mode, PanelTab } from '../features/diagrams/editor/types';
import { DiagramPageHeader } from '../features/diagrams/editor/DiagramPageHeader';
import { DiagramEditorDialog } from '../features/diagrams/editor/DiagramEditorDialog';
import { DiagramSidePanel } from '../features/diagrams/panel/DiagramSidePanel';
import { useDiagramList } from '../features/diagrams/editor/useDiagramList';
import { useDiagramDocument } from '../features/diagrams/editor/useDiagramDocument';
import { useDiagramMutations } from '../features/diagrams/editor/useDiagramMutations';

export default function Diagrams() {
  const params = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { push } = useToast();
  const { settings } = useApp();
  const livePing = useLivePing();
  const canWrite = can('diagrams:write');

  const idParam = Number(params.id);
  const currentId = Number.isInteger(idParam) && idParam > 0 ? idParam : null;

  const canvas = useCanvasHistory();
  const { nodes, edges } = canvas;

  const [mode, setMode] = useState<Mode>('view');
  const [panelTab, setPanelTab] = useState<PanelTab>('tree');
  const { panelOpen, setPanelOpen, snapToGrid, setSnapToGrid, titleBlock, setTitleBlock, autoSave, setAutoSave } =
    useDiagramPreferences();
  const [dialog, setDialog] = useState<EditorDialog | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<DiagramExportFormat | null>(null);
  // هنگام کشیدن، ذخیرهٔ خودکار موقتاً متوقف می‌شود تا وسط حرکت اجرا نشود.
  const [dragging, setDragging] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [graph, setGraph] = useState<DiagramGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  // مسیر دیاگرام‌هایی که با پیوند باز شده‌اند تا «بازگشت» ممکن باشد.
  const [trail, setTrail] = useState<{ id: number; name: string }[]>([]);
  const canvasRef = useRef<DiagramCanvasHandle | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageTargetNode = useRef<string | null>(null);

  const editing = mode === 'edit' && canWrite;

  const { list, setList, listLoading, loadList } = useDiagramList(push);

  // تجهیزات مانیتورینگ برای وضعیت زندهٔ گره‌ها، تب «تجهیزات» و همگام‌سازی
  const devicesAsync = useAsync((signal) => api.devices({ pageSize: 500, sort: 'name', order: 'asc' }, signal), [], {
    interval: 15000,
  });
  const devicesById = useMemo(() => {
    const map = new Map<number, Device>();
    for (const device of devicesAsync.data?.items ?? []) map.set(device.id, device);
    return map;
  }, [devicesAsync.data]);

  const {
    detail,
    setDetail,
    detailLoading,
    error,
    revision,
    dirty,
    setDirty,
    saving,
    loadVersion,
    markDirty,
    save,
    reload,
    requestReload,
  } = useDiagramDocument({
    currentId,
    canvas,
    canWrite,
    editing,
    autoSave,
    dragging,
    push,
    onSaved: loadList,
  });

  const {
    tool,
    setTool,
    pending,
    setPending,
    linkSource,
    setLinkSource,
    connectionKind,
    syncing,
    clipCount,
    beginDrag,
    endDrag,
    pickDeviceFromList,
    syncNodeWithDevice,
    syncAllDevices,
    handleNodesChange,
    handleEdgesChange,
    changeConnectionKind,
    handleConnect,
    pickLinkNode,
    handleNodesDelete,
    handleEdgesDelete,
    handlePaneClickAt,
    dropDeviceOnCanvas,
    patchNodeData,
    patchNodeSize,
    patchEdge,
    removeNode,
    removeEdge,
    toggleGroup,
    deleteSelection,
    alignSelection,
    distributeSelection,
    recolorSelection,
    copySelection,
    pasteClipboard,
    cutSelection,
    duplicateSelection,
    nudgeSelection,
    connectHint,
    pendingHint,
  } = useDiagramMutations({
    canvas,
    devicesById,
    editing,
    snapToGrid,
    detail,
    loadVersion,
    setDragging,
    markDirty,
    push,
  });

  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((edge) => edge.selected), [edges]);
  const selectedNode = selectedNodes[0] ?? null;
  const selectedEdge = edges.find((edge) => edge.selected) ?? null;
  const selectedColor = selectedNode ? String(selectedNode.data.color ?? '#2563eb') : null;
  const hasSelection = selectedNodes.length > 0 || selectedEdges.length > 0;

  // انتخاب خودکار نخستین دیاگرام وقتی آدرس شناسه ندارد
  useEffect(() => {
    if (currentId || !list.length) return;
    navigate(`/diagrams/${list[0].id}`, { replace: true });
  }, [currentId, list, navigate]);

  const openPanel = useCallback((tab: PanelTab) => {
    setPanelOpen(true);
    setPanelTab(tab);
  }, []);

  const openDevicePage = useCallback(
    (deviceId: number) => {
      navigate(`/devices/${deviceId}`);
    },
    [navigate]
  );

  const pingDevice = useCallback(
    (deviceId: number) => {
      const device = devicesById.get(deviceId);
      if (!device) return;
      livePing.open({ id: device.id, name: device.name, ip: device.ip, status: device.status });
    },
    [devicesById, livePing]
  );

  /* ---------------------------------------------------------------- */
  /* میان‌برهای صفحه‌کلید                                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = isTypingTarget(event.target);
      if (event.key === 'Escape') {
        setPending(null);
        setTool('select');
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if (typing || !editing) return;
      const key = event.key.toLowerCase();
      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (canvas.undo()) markDirty();
        return;
      }
      if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault();
        if (canvas.redo()) markDirty();
        return;
      }
      if (mod && key === 'c') {
        event.preventDefault();
        copySelection();
        return;
      }
      if (mod && key === 'x') {
        event.preventDefault();
        cutSelection();
        return;
      }
      if (mod && key === 'v') {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        duplicateSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canvas, copySelection, cutSelection, duplicateSelection, editing, markDirty, pasteClipboard, save]);

  // جابه‌جایی با کلیدهای جهت.
  //
  // React Flow خودش نیز با کلیدهای جهت، انتخاب را ۵ پیکسل (یا اندازهٔ شبکه)
  // جابه‌جا می‌کند و آن حرکت در تاریخچهٔ واگرد ثبت نمی‌شود. این شنونده در فاز
  // Capture اجرا می‌شود و رویداد را می‌بلعد تا فقط حرکت دقیق ۱/۱۰ پیکسلی خودمان
  // (با گام واگرد) اعمال شود.
  useEffect(() => {
    const onArrow = (event: KeyboardEvent) => {
      if (!event.key.startsWith('Arrow')) return;
      if (!editing || isTypingTarget(event.target)) return;
      if (!canvas.snapshot().nodes.some((node) => node.selected)) return;
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      nudgeSelection(dx, dy);
    };
    window.addEventListener('keydown', onArrow, true);
    return () => window.removeEventListener('keydown', onArrow, true);
  }, [canvas, editing, nudgeSelection]);

  /* ---------------------------------------------------------------- */
  /* تصویر                                                            */
  /* ---------------------------------------------------------------- */

  const pickImage = useCallback(
    (nodeId?: string) => {
      if (!currentId) return;
      imageTargetNode.current = nodeId ?? null;
      imageInput.current?.click();
    },
    [currentId]
  );

  const onImageSelected = useCallback(
    async (file: File | null) => {
      if (!file || !currentId) return;
      if (!file.type.startsWith('image/')) {
        push('فقط فایل تصویری (PNG/JPEG/GIF/WebP) مجاز است.', 'warning');
        return;
      }
      setUploadingImage(true);
      try {
        const attachment = await api.uploadDiagramAttachment(currentId, file);
        const target = imageTargetNode.current;
        imageTargetNode.current = null;
        if (target) {
          patchNodeData(target, {
            src: attachment.downloadUrl,
            attachmentId: attachment.id,
            ...(file.name ? { caption: file.name.replace(/\.[^.]+$/, '') } : {}),
          });
          push('تصویر جایگزین شد.', 'success');
        } else {
          setPending({ kind: 'image', src: attachment.downloadUrl, attachmentId: attachment.id });
          push('روی بوم کلیک کنید تا تصویر قرار گیرد.', 'info');
        }
      } catch (e) {
        push(e instanceof ApiError ? e.message : 'بارگذاری تصویر ناموفق بود.', 'error');
      } finally {
        setUploadingImage(false);
      }
    },
    [currentId, patchNodeData, push]
  );

  /* ---------------------------------------------------------------- */
  /* خروجی                                                            */
  /* ---------------------------------------------------------------- */

  /** خروجی تصویر/PDF از کل بوم دیاگرام */
  const exportDiagram = useCallback(
    async (format: DiagramExportFormat) => {
      if (!canvasRef.current || exporting) return;
      setExporting(format);
      try {
        await canvasRef.current.exportImage(format);
        push(format === 'png' ? 'تصویر دیاگرام دانلود شد.' : 'خروجی PDF دیاگرام دانلود شد.', 'success');
      } catch (e) {
        push(e instanceof Error ? e.message : 'خروجی گرفتن ناموفق بود.', 'error');
      } finally {
        setExporting(null);
      }
    },
    [exporting, push]
  );

  const exportMeta = useMemo(
    () => ({
      name: detail?.name ?? 'دیاگرام شبکه',
      description: detail?.description ?? '',
      revision: detail?.revision ?? revision,
      updatedAt: detail?.updatedAt ?? Date.now(),
      createdBy: detail?.createdBy ?? '',
      siteName: settings?.site_name ?? 'NetWatch',
      timezoneOffset: settings?.timezone_offset_minutes ?? 210,
    }),
    [detail, revision, settings?.site_name, settings?.timezone_offset_minutes]
  );

  /* ---------------------------------------------------------------- */
  /* دیاگرام‌ها                                                        */
  /* ---------------------------------------------------------------- */

  const openDiagram = useCallback(
    (nextId: number, options?: { fromLink?: boolean; nodeId?: string }) => {
      if (nextId === currentId && !options?.nodeId) return;
      if (dirty && !window.confirm('تغییرات این دیاگرام ذخیره نشده است. بدون ذخیره ادامه می‌دهید؟')) return;
      setDirty(false);
      // رفتن از طریق پیوند/نقشهٔ ارتباط، مسیر بازگشت می‌سازد تا کاربر گم نشود.
      if (options?.fromLink && currentId && currentId !== nextId) {
        setTrail((prev) => [
          ...prev.filter((item) => item.id !== currentId),
          { id: currentId, name: detail?.name ?? `#${faDigits(currentId)}` },
        ]);
      }
      const suffix = options?.nodeId ? `?node=${encodeURIComponent(options.nodeId)}` : '';
      navigate(`/diagrams/${nextId}${suffix}`);
    },
    [currentId, detail?.name, dirty, navigate]
  );

  const goBackInTrail = useCallback(() => {
    const previous = trail[trail.length - 1];
    if (!previous) return;
    setTrail((items) => items.slice(0, -1));
    navigate(`/diagrams/${previous.id}`);
  }, [navigate, trail]);

  const loadGraph = useCallback(() => {
    setGraphLoading(true);
    setGraphError(null);
    api
      .diagramGraph()
      .then((data) => {
        setGraph(data);
        setGraphError(null);
      })
      .catch((e) => {
        const message = e instanceof ApiError ? e.message : 'دریافت نقشهٔ ارتباط ناموفق بود.';
        setGraphError(message);
        push(message, 'error');
      })
      .finally(() => setGraphLoading(false));
  }, [push]);

  const startCreate = useCallback((parentId: number | null) => {
    setDialog({ mode: 'create', parentId });
    setFormName('');
    setFormDescription('');
  }, []);

  const startEdit = useCallback((diagram: DiagramSummary) => {
    setDialog({ mode: 'edit', diagram });
    setFormName(diagram.name);
    setFormDescription(diagram.description);
  }, []);

  const submitDialog = useCallback(async () => {
    if (!dialog || busy) return;
    const name = formName.trim();
    if (!name) {
      push('نام دیاگرام را وارد کنید.', 'warning');
      return;
    }
    setBusy(true);
    try {
      if (dialog.mode === 'create') {
        const created = await api.createDiagram({
          name,
          description: formDescription,
          parentId: dialog.parentId ?? null,
        });
        setDialog(null);
        await loadList();
        navigate(`/diagrams/${created.id}`);
        push('دیاگرام ساخته شد.', 'success');
      } else if (dialog.diagram) {
        const updated = await api.updateDiagram(dialog.diagram.id, { name, description: formDescription });
        setDialog(null);
        await loadList();
        if (detail?.id === updated.id)
          setDetail((prev) => (prev ? { ...prev, name: updated.name, description: updated.description } : prev));
        // با تغییر نام، سرور برچسب پیوندهای این دیاگرام را در بوم‌های دیگر
        // هم عوض می‌کند و نسخهٔ آن‌ها را بالا می‌برد. اگر بوم باز یکی از
        // همان‌هاست، نسخهٔ تازه بارگذاری می‌شود تا برچسب تازه دیده شود.
        const affected = (updated as typeof updated & { relabeledDiagrams?: number[] }).relabeledDiagrams ?? [];
        if (detail?.id && affected.includes(detail.id)) {
          if (dirty) {
            push(
              'نام یک دیاگرام مقصد عوض شد و برچسب پیوندهایش در این بوم به‌روز شده است؛ برای دیدن آن، بوم را بازخوانی کنید.',
              'info'
            );
          } else {
            requestReload();
          }
        }
        push('اطلاعات دیاگرام به‌روزرسانی شد.', 'success');
      }
    } catch (e) {
      push(e instanceof ApiError ? e.message : 'عملیات ناموفق بود.', 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, detail?.id, dialog, dirty, formDescription, formName, loadList, navigate, push]);

  const confirmDelete = useCallback(
    async (diagram: DiagramSummary) => {
      const descendants = (() => {
        const ids = new Set<number>([diagram.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const item of list) {
            if (item.parentId != null && ids.has(item.parentId) && !ids.has(item.id)) {
              ids.add(item.id);
              grew = true;
            }
          }
        }
        return ids.size - 1;
      })();
      const message =
        descendants > 0
          ? `دیاگرام «${diagram.name}» و ${faDigits(descendants)} زیرمجموعهٔ آن حذف شوند؟ این عملیات بازگشت‌پذیر نیست.`
          : `دیاگرام «${diagram.name}» حذف شود؟ این عملیات بازگشت‌پذیر نیست.`;
      if (!window.confirm(message)) return;
      try {
        await api.deleteDiagram(diagram.id);
        setList((current) => current.filter((item) => !(item.id === diagram.id || item.parentId === diagram.id)));
        push('دیاگرام حذف شد.', 'success');
        const fresh = await api.diagrams();
        setList(fresh.items);
        if (currentId === diagram.id || !fresh.items.some((item) => item.id === currentId)) {
          if (fresh.items.length) navigate(`/diagrams/${fresh.items[0].id}`, { replace: true });
          else navigate('/diagrams', { replace: true });
        }
      } catch (e) {
        push(e instanceof ApiError ? e.message : 'حذف دیاگرام ناموفق بود.', 'error');
      }
    },
    [currentId, list, navigate, push]
  );

  const selectedDevice = useMemo(() => {
    const deviceId = selectedNode?.data.deviceId ? Number(selectedNode.data.deviceId) : null;
    return deviceId ? (devicesById.get(deviceId) ?? null) : null;
  }, [devicesById, selectedNode]);

  // مسیر سلسله‌مراتبی دیاگرام جاری؛ برخلاف trail که مسیر پیوندهاست، این مسیر
  // از parentId ساخته می‌شود و همیشه ریشه تا دیاگرام باز را نشان می‌دهد.
  const breadcrumb = useMemo(() => {
    if (!detail) return [] as DiagramSummary[];
    const byId = new Map(list.map((item) => [item.id, item]));
    const chain: DiagramSummary[] = [];
    const seen = new Set<number>();
    let cursor: DiagramSummary | null = detail;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.unshift(cursor);
      cursor = cursor.parentId ? (byId.get(cursor.parentId) ?? null) : null;
    }
    return chain;
  }, [detail, list]);

  return (
    <div>
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = '';
          void onImageSelected(file);
        }}
      />

      <DiagramPageHeader
        detail={detail}
        nodeCount={nodes.length}
        edgeCount={edges.length}
        dirty={dirty}
        editing={editing}
        mode={mode}
        canWrite={canWrite}
        panelOpen={panelOpen}
        titleBlock={titleBlock}
        exporting={exporting}
        autoSave={autoSave}
        saving={saving}
        onOpenPanel={() => setPanelOpen(true)}
        onMode={setMode}
        onOverview={() => {
          setOverviewOpen(true);
          loadGraph();
        }}
        onToggleTitleBlock={() => setTitleBlock((value) => !value)}
        onExport={(format) => void exportDiagram(format)}
        onReload={reload}
        onToggleAutoSave={() => setAutoSave((value) => !value)}
        onSave={() => void save()}
      />

      <div className="diagram-workspace relative flex gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {detail ? (
            <nav
              className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-ink-200/70 bg-surface/80 px-2 py-1 text-[10.5px] text-ink-500"
              aria-label="مسیر دیاگرام"
              dir="rtl"
            >
              <button
                type="button"
                className="shrink-0 rounded px-0.5 text-ink-400 transition hover:text-accent"
                onClick={() => {
                  setPanelOpen(true);
                  setPanelTab('tree');
                }}
                title="نمایش فهرست دیاگرام‌ها"
              >
                دیاگرام‌ها
              </button>
              {breadcrumb.map((item, index) => {
                const isCurrent = index === breadcrumb.length - 1;
                return (
                  <span key={item.id} className="flex min-w-0 shrink-0 items-center gap-1">
                    <ChevronLeft size={11} className="shrink-0 text-ink-300" aria-hidden />
                    {isCurrent ? (
                      <span
                        className="max-w-[220px] truncate font-medium text-ink-800"
                        aria-current="page"
                        title={item.name}
                      >
                        {item.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="max-w-[160px] truncate rounded px-0.5 transition hover:text-accent"
                        onClick={() => openDiagram(item.id)}
                        title={`باز کردن «${item.name}»`}
                      >
                        {item.name}
                      </button>
                    )}
                  </span>
                );
              })}
              {trail.length ? <span className="shrink-0 text-ink-400">· از مسیر پیوند</span> : null}
            </nav>
          ) : null}
          {trail.length ? (
            <div
              className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ink-200/70 bg-surface/80 px-2 py-1 text-[10.5px] text-ink-500"
              dir="rtl"
            >
              <button type="button" className="btn-ghost btn-xs" onClick={goBackInTrail} title="بازگشت به دیاگرام قبلی">
                <ArrowRight size={12} />
                بازگشت
              </button>
              <span className="min-w-0 truncate">مسیر پیوند: {trail.map((item) => item.name).join(' ‹ ')}</span>
              <button
                type="button"
                className="btn-ghost btn-xs ms-auto"
                onClick={() => setTrail([])}
                title="پاک کردن مسیر"
                aria-label="پاک کردن مسیر پیوند"
              >
                <X size={11} />
              </button>
            </div>
          ) : null}
          {editing ? (
            <DiagramToolbar
              tool={tool}
              pending={pending}
              connectionKind={connectionKind}
              selectedColor={selectedColor}
              hasSelection={hasSelection}
              selectedCount={selectedNodes.length}
              canUndo={canvas.canUndo}
              canRedo={canvas.canRedo}
              snapToGrid={snapToGrid}
              clipboardCount={clipCount}
              onSelectTool={() => {
                setTool('select');
                setPending(null);
                setLinkSource(null);
              }}
              onConnectTool={() => {
                setTool('connect');
                setPending(null);
                setLinkSource(null);
              }}
              onPickDevice={(key) => {
                setPending({ kind: 'device', deviceKey: key });
                setTool('select');
              }}
              onPickShape={(shape: DiagramShape) => {
                setPending({ kind: 'shape', shape });
                setTool('select');
              }}
              onPickNote={() => {
                setPending({ kind: 'note' });
                setTool('select');
              }}
              onPickGroup={() => {
                setPending({ kind: 'group' });
                setTool('select');
              }}
              onPickImage={() => pickImage()}
              diagrams={list.filter((item) => item.id !== currentId)}
              onPickDiagram={(target) => {
                setPending({
                  kind: 'diagram',
                  diagramId: target.id,
                  label: target.name,
                  description: target.description,
                });
                setTool('select');
              }}
              onConnectionKind={changeConnectionKind}
              onColor={(color) => {
                if (selectedNode) patchNodeData(selectedNode.id, { color });
              }}
              onGroupColor={recolorSelection}
              onDelete={deleteSelection}
              onUndo={() => {
                if (canvas.undo()) markDirty();
              }}
              onRedo={() => {
                if (canvas.redo()) markDirty();
              }}
              onToggleSnap={() => setSnapToGrid((value) => !value)}
              onSyncDevices={syncAllDevices}
              syncing={syncing || devicesAsync.loading}
              onCopy={copySelection}
              onPaste={pasteClipboard}
              onDuplicate={duplicateSelection}
              onAlign={alignSelection}
              onDistribute={distributeSelection}
            />
          ) : null}

          <div className="min-h-0 flex-1">
            {detailLoading && !detail ? (
              <div className="grid h-full place-items-center rounded-2xl border border-ink-200/70 bg-surface">
                <PageLoader label="در حال باز کردن دیاگرام…" />
              </div>
            ) : error ? (
              <div className="grid h-full place-items-center rounded-2xl border border-ink-200/70 bg-surface p-6">
                <div className="text-center">
                  <AlertCircle size={26} className="mx-auto text-danger" />
                  <p className="mt-2 text-[12.5px] text-ink-600">{error}</p>
                  <button type="button" className="btn-ghost btn-xs mt-3" onClick={reload}>
                    تلاش دوباره
                  </button>
                </div>
              </div>
            ) : currentId && detail ? (
              <ReactFlowProvider key={detail.id}>
                <DiagramCanvas
                  ref={canvasRef}
                  diagramName={detail.name}
                  placing={!!pending}
                  nodes={nodes}
                  edges={edges}
                  editing={editing}
                  connectable={tool === 'connect'}
                  onNodesChange={handleNodesChange}
                  onEdgesChange={handleEdgesChange}
                  onConnect={handleConnect}
                  onNodesDelete={handleNodesDelete}
                  onEdgesDelete={handleEdgesDelete}
                  onPaneClick={handlePaneClickAt}
                  onInspect={() => openPanel('inspector')}
                  onEdgeInspect={() => openPanel('inspector')}
                  pendingHint={editing && tool === 'connect' ? connectHint : pendingHint}
                  onCancelPending={() => {
                    if (tool === 'connect') {
                      setLinkSource(null);
                      return;
                    }
                    setPending(null);
                    setTool('select');
                  }}
                  onPickLinkNode={pickLinkNode}
                  linkSourceId={tool === 'connect' ? linkSource : null}
                  devices={devicesById}
                  onOpenDevice={openDevicePage}
                  onOpenDiagram={(targetId) => openDiagram(targetId, { fromLink: true })}
                  onToggleGroup={toggleGroup}
                  exportMeta={exportMeta}
                  titleBlock={titleBlock}
                  snapToGrid={snapToGrid}
                  onDragStart={beginDrag}
                  onDragStop={endDrag}
                  onDropDevice={dropDeviceOnCanvas}
                />
              </ReactFlowProvider>
            ) : (
              <div className="grid h-full place-items-center rounded-2xl border border-ink-200/70 bg-surface p-6">
                <EmptyState
                  title="دیاگرامی انتخاب نشده است"
                  description="از پنل کناری یک دیاگرام بسازید یا انتخاب کنید. هر دیاگرام بوم و اجزای مستقل خودش را دارد."
                  action={
                    <button type="button" className="btn-primary btn-xs" onClick={() => startCreate(null)}>
                      ساخت نخستین دیاگرام
                    </button>
                  }
                />
              </div>
            )}
          </div>
        </div>

        <DiagramSidePanel
          open={panelOpen}
          tab={panelTab}
          onTabChange={setPanelTab}
          onClose={() => setPanelOpen(false)}
          tree={
            <DiagramTree
              items={list}
              currentId={currentId}
              loading={listLoading}
              onOpen={openDiagram}
              onCreate={startCreate}
              onEdit={startEdit}
              onDelete={(diagram) => void confirmDelete(diagram)}
              onRefresh={() => void loadList()}
            />
          }
          devices={<DiagramDevicePalette editing={editing} onPick={pickDeviceFromList} />}
          inspector={
            detail ? (
              <DiagramInspector
                editing={editing}
                diagram={detail}
                nodes={nodes}
                edges={edges}
                node={selectedNode}
                edge={selectedEdge}
                onPatchData={patchNodeData}
                onPatchNode={patchNodeSize}
                onPatchEdge={patchEdge}
                onDeleteNode={removeNode}
                onDeleteEdge={removeEdge}
                device={selectedDevice}
                onSyncDevice={syncNodeWithDevice}
                onOpenDevice={openDevicePage}
                onPingDevice={pingDevice}
                onReplaceImage={(nodeId) => pickImage(nodeId)}
                onOpenDiagram={(targetId) => openDiagram(targetId, { fromLink: true })}
                diagrams={list.filter((item) => item.id !== currentId)}
              />
            ) : (
              <p className="p-4 text-center text-[11px] text-ink-400">دیاگرامی انتخاب نشده است.</p>
            )
          }
        />
      </div>

      <DiagramOverview
        open={overviewOpen}
        graph={graph}
        loading={graphLoading}
        error={graphError}
        currentId={currentId}
        canWrite={canWrite}
        onClose={() => setOverviewOpen(false)}
        onOpen={(targetId, nodeId) => {
          setOverviewOpen(false);
          openDiagram(targetId, { fromLink: true, nodeId });
        }}
        onRefresh={loadGraph}
        onMutated={(sourceId) => {
          void loadList();
          // اگر پیوند روی همین دیاگرام بازِ کاربر ساخته/حذف شده، بوم هم تازه شود.
          if (sourceId && sourceId === currentId && !dirty) requestReload();
        }}
        onNotify={(message, tone) => push(message, tone ?? 'info')}
      />

      {uploadingImage ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[1000] rounded-pill border border-ink-200 bg-surface/95 px-3 py-1.5 text-[11.5px] text-ink-600 shadow-pop">
          در حال بارگذاری تصویر…
        </div>
      ) : null}

      <DiagramEditorDialog
        dialog={dialog}
        name={formName}
        description={formDescription}
        busy={busy}
        onClose={() => setDialog(null)}
        onNameChange={setFormName}
        onDescriptionChange={setFormDescription}
        onSubmit={() => void submitDialog()}
      />
    </div>
  );
}
