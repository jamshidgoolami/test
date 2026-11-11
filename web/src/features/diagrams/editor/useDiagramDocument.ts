import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, isAbortError } from '../../../lib/api';
import { serializeEdges, serializeNodes, toFlowEdge, toFlowNode } from '../../../lib/diagrams';
import type { DiagramDetail } from '../../../lib/types';
import type { CanvasHistory } from '../useCanvasHistory';
import type { DiagramToast } from './useDiagramList';

interface UseDiagramDocumentOptions {
  currentId: number | null;
  canvas: CanvasHistory;
  canWrite: boolean;
  editing: boolean;
  autoSave: boolean;
  dragging: boolean;
  push: DiagramToast;
  onSaved: () => void | Promise<void>;
}

/**
 * چرخهٔ سند دیاگرام: بارگذاری، ذخیرهٔ دستی/خودکار، بازخوانی و وضعیت
 * «ذخیره‌نشده».
 *
 * revision مرجع سرور است و جدا از شمارندهٔ تغییرات محلی نگه داشته می‌شود.
 * اگر در فاصلهٔ درخواست ذخیره تغییری رخ دهد، dirty باقی می‌ماند تا تغییر
 * از دست نرود. خطای 409 ذخیرهٔ خودکار را تا بازخوانی متوقف می‌کند.
 */
export function useDiagramDocument({
  currentId,
  canvas,
  canWrite,
  editing,
  autoSave,
  dragging,
  push,
  onSaved,
}: UseDiagramDocumentOptions) {
  const [detail, setDetail] = useState<DiagramDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loadVersion, setLoadVersion] = useState(0);

  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const autoSaveBlocked = useRef(false);
  const mutationSeq = useRef(0);

  const markDirty = useCallback(() => {
    mutationSeq.current += 1;
    setDirty(true);
  }, []);

  // بارگذاری محتوای دیاگرام انتخاب‌شده
  useEffect(() => {
    if (!currentId) {
      setDetail(null);
      canvas.replace({ nodes: [], edges: [] });
      setRevision(0);
      revisionRef.current = 0;
      setDirty(false);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setDetailLoading(true);
    setError(null);
    autoSaveBlocked.current = false;
    api
      .diagram(currentId, controller.signal)
      .then((data) => {
        if (!alive) return;
        setDetail(data);
        canvas.replace({ nodes: data.nodes.map(toFlowNode), edges: data.edges.map(toFlowEdge) });
        setRevision(data.revision);
        revisionRef.current = data.revision;
        setDirty(false);
        setLoadVersion((value) => value + 1);
        // اگر از نقشهٔ ارتباط با ?node= آمده‌ایم، همان جزء پیوند انتخاب شود.
        const requestedNode = new URLSearchParams(window.location.search).get('node');
        if (requestedNode && data.nodes.some((node) => node.id === requestedNode)) {
          canvas.apply(
            (prev) => ({
              ...prev,
              nodes: prev.nodes.map((node) => ({ ...node, selected: node.id === requestedNode })),
            }),
            false
          );
        }
      })
      .catch((loadError) => {
        if (!alive || isAbortError(loadError)) return;
        setError(loadError instanceof ApiError ? loadError.message : 'دریافت دیاگرام ناموفق بود.');
        setDetail(null);
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
    // canvas پایدار است؛ محرک‌های واقعی شناسه و بازخوانی اجباری‌اند.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, reloadNonce]);

  const save = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!detail || !canWrite || !editing || savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      const seq = mutationSeq.current;
      const snap = canvas.snapshot();
      try {
        const updated = await api.saveDiagramContent(detail.id, {
          revision: revisionRef.current,
          nodes: serializeNodes(snap.nodes),
          edges: serializeEdges(snap.edges),
        });
        setRevision(updated.revision);
        revisionRef.current = updated.revision;
        setDetail(updated);
        autoSaveBlocked.current = false;
        if (mutationSeq.current === seq) setDirty(false);
        if (!options.silent) push('دیاگرام ذخیره شد.', 'success');
        void onSaved();
      } catch (saveError) {
        if (saveError instanceof ApiError && saveError.status === 409) {
          autoSaveBlocked.current = true;
          push('این دیاگرام در جای دیگری تغییر کرده است. با «بازخوانی» نسخهٔ تازه را بارگذاری کنید.', 'error');
        } else if (!options.silent) {
          push(saveError instanceof ApiError ? saveError.message : 'ذخیرهٔ دیاگرام ناموفق بود.', 'error');
        } else {
          push(saveError instanceof ApiError ? saveError.message : 'ذخیرهٔ خودکار ناموفق بود.', 'error');
        }
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [canvas, canWrite, detail, editing, onSaved, push]
  );

  // ذخیرهٔ خودکار با تأخیر کوتاه پس از آخرین تغییر
  useEffect(() => {
    if (!editing || !dirty || !autoSave || dragging || autoSaveBlocked.current || saving) return;
    const timer = window.setTimeout(() => {
      void save({ silent: true });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [autoSave, canvas.edges, canvas.nodes, dirty, dragging, editing, save, saving]);

  const reload = useCallback(() => {
    if (!currentId) return;
    if (dirty && !window.confirm('تغییرات ذخیره‌نشده از دست می‌رود. نسخهٔ تازه بارگذاری شود؟')) return;
    api
      .diagram(currentId)
      .then((data) => {
        setDetail(data);
        canvas.replace({ nodes: data.nodes.map(toFlowNode), edges: data.edges.map(toFlowEdge) });
        setRevision(data.revision);
        revisionRef.current = data.revision;
        setDirty(false);
        autoSaveBlocked.current = false;
        push('نسخهٔ تازهٔ دیاگرام بارگذاری شد.', 'info');
      })
      .catch((reloadError) =>
        push(reloadError instanceof ApiError ? reloadError.message : 'بارگذاری مجدد ناموفق بود.', 'error')
      );
  }, [canvas, currentId, dirty, push]);

  const requestReload = useCallback(() => setReloadNonce((value) => value + 1), []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return {
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
  };
}
