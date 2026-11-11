import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import {
  alignNodes,
  clipboardCount,
  copyToClipboard,
  createDeviceNode,
  createDiagramLinkNode,
  createGroupNode,
  createImageNode,
  createNoteNode,
  createShapeNode,
  deviceCatalogKey,
  deviceNodeNeedsSync,
  deviceNodeSyncPatch,
  distributeNodes,
  newId,
  pasteFromClipboard,
} from '../../../lib/diagrams';
import type { AlignMode, DiagramDeviceDragPayload, DiagramFlowEdge, DiagramFlowNode } from '../../../lib/diagrams';
import { faDigits } from '../../../lib/format';
import type {
  Device,
  DiagramConnectionKind,
  DiagramDetail,
  DiagramEdgeData,
  DiagramNodeData,
} from '../../../lib/types';
import type { CanvasHistory } from '../useCanvasHistory';
import type { CanvasTool, PendingTool } from '../DiagramToolbar';
import type { DiagramToast } from './useDiagramList';

interface UseDiagramMutationsOptions {
  canvas: CanvasHistory;
  devicesById: Map<number, Device>;
  editing: boolean;
  snapToGrid: boolean;
  detail: DiagramDetail | null;
  loadVersion: number;
  setDragging: (dragging: boolean) => void;
  markDirty: () => void;
  push: DiagramToast;
}

/**
 * همهٔ تغییرات بوم در یک مرز مشخص: هر mutation از apply عبور می‌کند تا
 * Undo/Redo و علامت «ذخیره‌نشده» یکسان بمانند. همگام‌سازی تجهیزات نیز از
 * همین مرز استفاده می‌کند و منبع داده‌اش devicesById است.
 */
export function useDiagramMutations({
  canvas,
  devicesById,
  editing,
  snapToGrid,
  detail,
  loadVersion,
  setDragging,
  markDirty,
  push,
}: UseDiagramMutationsOptions) {
  const [tool, setTool] = useState<CanvasTool>('select');
  const [pending, setPending] = useState<PendingTool>(null);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [connectionKind, setConnectionKind] = useState<DiagramConnectionKind>('fiber');
  const [syncing, setSyncing] = useState(false);
  const [clipCount, setClipCount] = useState(() => clipboardCount());

  const connectionKindRef = useRef<DiagramConnectionKind>('fiber');
  const dragSnapshot = useRef<ReturnType<typeof canvas.snapshot> | null>(null);
  const resizeRecorded = useRef(false);
  const nudgeSnapshot = useRef<ReturnType<typeof canvas.snapshot> | null>(null);
  const nudgeTimer = useRef<number | null>(null);
  const autoSyncedFor = useRef<string | null>(null);

  const applyCanvas = useCallback(
    (
      updater: (prev: { nodes: DiagramFlowNode[]; edges: DiagramFlowEdge[] }) => {
        nodes: DiagramFlowNode[];
        edges: DiagramFlowEdge[];
      }
    ) => {
      const changed = canvas.apply(updater);
      if (changed) markDirty();
      return changed;
    },
    [canvas, markDirty]
  );

  useEffect(() => {
    if (tool !== 'connect' || !editing) setLinkSource(null);
  }, [tool, editing]);

  useEffect(
    () => () => {
      if (nudgeTimer.current != null) window.clearTimeout(nudgeTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!editing) {
      setPending(null);
      setTool('select');
    }
  }, [editing]);

  /** افزودن تجهیز واقعی مانیتورینگ به بوم (انتخاب از تب «تجهیزات») */
  const pickDeviceFromList = useCallback((device: Device) => {
    setPending({
      kind: 'device',
      deviceKey: deviceCatalogKey(device.deviceType),
      deviceId: device.id,
      label: device.name,
      model: device.model,
    });
    setTool('select');
  }, []);

  /* ---------------------------------------------------------------- */
  /* همگام‌سازی با تجهیزات واقعی                                      */
  /* ---------------------------------------------------------------- */

  /** یک گره را با رکورد تجهیز همراهش به‌روز می‌کند؛ خروجی: تغییر کرد؟ */
  const syncNodeWithDevice = useCallback(
    (nodeId: string): boolean => {
      const node = canvas.snapshot().nodes.find((item) => item.id === nodeId);
      const device = node?.data.deviceId ? devicesById.get(Number(node.data.deviceId)) : null;
      if (!node || !device) return false;
      const patch = deviceNodeSyncPatch(node.data, device);
      return applyCanvas((prev) => ({
        ...prev,
        nodes: prev.nodes.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, ...patch } } : item)),
      }));
    },
    [applyCanvas, canvas, devicesById]
  );

  /** همگام‌سازی همهٔ تجهیزات بوم با رکوردهای مانیتورینگ */
  const syncAllDevices = useCallback(() => {
    const current = canvas.snapshot().nodes;
    let updated = 0;
    const next = current.map((node) => {
      const device = node.data.deviceId ? devicesById.get(Number(node.data.deviceId)) : null;
      if (!device || !deviceNodeNeedsSync(node.data, device)) return node;
      updated += 1;
      return { ...node, data: { ...node.data, ...deviceNodeSyncPatch(node.data, device) } };
    });
    if (!updated) {
      push('همهٔ تجهیزات بوم با رکورد مانیتورینگ همگام هستند.', 'info');
      return;
    }
    setSyncing(true);
    applyCanvas((prev) => ({ ...prev, nodes: next }));
    setSyncing(false);
    push(`نام، نوع و مشخصات ${faDigits(updated)} تجهیز همگام شد.`, 'success');
  }, [applyCanvas, canvas, devicesById, push]);

  // همگام‌سازی خودکار یک‌بار پس از باز شدن هر دیاگرام (تغییر قابل‌واگرد و
  // قابل‌ذخیره است؛ اگر چیزی عوض نشود هیچ گامی ساخته نمی‌شود).
  useEffect(() => {
    if (!detail || !devicesById.size) return;
    const key = `${detail.id}:${loadVersion}`;
    if (autoSyncedFor.current === key) return;
    autoSyncedFor.current = key;
    const current = canvas.snapshot().nodes;
    const needs = current.some((node) => {
      const device = node.data.deviceId ? devicesById.get(Number(node.data.deviceId)) : null;
      return !!device && deviceNodeNeedsSync(node.data, device);
    });
    if (!needs) return;
    applyCanvas((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => {
        const device = node.data.deviceId ? devicesById.get(Number(node.data.deviceId)) : null;
        if (!device) return node;
        return { ...node, data: { ...node.data, ...deviceNodeSyncPatch(node.data, device) } };
      }),
    }));
  }, [applyCanvas, canvas, detail, devicesById, loadVersion]);

  /* ---------------------------------------------------------------- */
  /* تغییرات بوم                                                      */
  /* ---------------------------------------------------------------- */

  const handleNodesChange = useCallback(
    (changes: NodeChange<DiagramFlowNode>[]) => {
      const resizing = changes.some((change) => change.type === 'dimensions' && change.resizing === true);
      const resizeSettled = changes.some((change) => change.type === 'dimensions' && change.resizing !== true);
      const structural = changes.some(
        (change) => change.type === 'remove' || change.type === 'add' || change.type === 'replace'
      );
      // تغییر اندازه پیوسته است؛ وضعیت پیش از آن یک‌بار ثبت می‌شود.
      if (resizing && !resizeRecorded.current) {
        resizeRecorded.current = true;
        canvas.pushSnapshot(canvas.snapshot());
      }
      if (resizeSettled && resizeRecorded.current) resizeRecorded.current = false;

      canvas.apply((prev) => {
        const next = applyNodeChanges(changes, prev.nodes);
        return next === prev.nodes ? prev : { ...prev, nodes: next };
      }, structural);

      const meaningful = changes.some((change) => {
        if (change.type === 'select') return false;
        if (change.type === 'dimensions') {
          return (
            change.resizing === true ||
            change.setAttributes === true ||
            change.setAttributes === 'width' ||
            change.setAttributes === 'height'
          );
        }
        return true;
      });
      if (meaningful) markDirty();
    },
    [canvas, markDirty]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<DiagramFlowEdge>[]) => {
      const structural = changes.some(
        (change) => change.type === 'remove' || change.type === 'add' || change.type === 'replace'
      );
      canvas.apply((prev) => {
        const next = applyEdgeChanges(changes, prev.edges);
        return next === prev.edges ? prev : { ...prev, edges: next };
      }, structural);
      if (changes.some((change) => change.type !== 'select')) markDirty();
    },
    [canvas, markDirty]
  );

  const changeConnectionKind = useCallback((kind: DiagramConnectionKind) => {
    connectionKindRef.current = kind;
    setConnectionKind(kind);
    // اگر ابزار اتصال فعال است، فعال می‌ماند و نوع تازه بلافاصله روی ارتباط
    // بعدی اعمال می‌شود؛ در حالت انتخاب هم ابزار عوض نمی‌شود تا انتخاب/جابه‌جایی
    // ناخواسته به رسم ارتباط تبدیل نشود.
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      const sourceHandle = connection.sourceHandle ?? 'right';
      const targetHandle = connection.targetHandle ?? 'left';
      applyCanvas((prev) => {
        // مسیر خط از هندسهٔ گره‌ها ساخته می‌شود، پس هر جفت جزء فقط یک یال دارد.
        if (
          prev.edges.some(
            (edge) =>
              (edge.source === connection.source && edge.target === connection.target) ||
              (edge.source === connection.target && edge.target === connection.source)
          )
        ) {
          return prev;
        }
        return {
          ...prev,
          edges: [
            ...prev.edges,
            {
              id: newId(),
              type: 'diagram',
              source: connection.source as string,
              target: connection.target as string,
              sourceHandle,
              targetHandle,
              data: { kind: connectionKindRef.current, label: '' },
            },
          ],
        };
      });
    },
    [applyCanvas]
  );

  /** اتصال دوکلیکی: کلیک روی تجهیز اول، سپس کلیک روی تجهیز دوم. */
  const pickLinkNode = useCallback(
    (nodeId: string) => {
      if (!editing || tool !== 'connect') return;
      if (!linkSource) {
        setLinkSource(nodeId);
        return;
      }
      if (linkSource === nodeId) {
        setLinkSource(null);
        return;
      }
      const source = linkSource;
      setLinkSource(null);
      const exists = canvas
        .snapshot()
        .edges.some(
          (edge) =>
            (edge.source === source && edge.target === nodeId) || (edge.source === nodeId && edge.target === source)
        );
      if (exists) {
        push('این دو جزء از قبل به هم متصل هستند.', 'info');
        return;
      }
      applyCanvas((prev) => ({
        ...prev,
        edges: [
          ...prev.edges,
          {
            id: newId(),
            type: 'diagram',
            source,
            target: nodeId,
            sourceHandle: 'right',
            targetHandle: 'left',
            data: { kind: connectionKindRef.current, label: '' },
          },
        ],
      }));
    },
    [applyCanvas, canvas, editing, linkSource, push, tool]
  );

  const handleNodesDelete = useCallback(
    (deleted: DiagramFlowNode[]) => {
      const ids = new Set(deleted.map((node) => node.id));
      canvas.apply((prev) => {
        const nextEdges = prev.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
        return nextEdges.length === prev.edges.length ? prev : { ...prev, edges: nextEdges };
      });
      markDirty();
    },
    [canvas, markDirty]
  );

  const handleEdgesDelete = useCallback(() => {
    markDirty();
  }, [markDirty]);

  const addAt = useCallback(
    (position: { x: number; y: number }) => {
      if (!pending || !editing) return;
      const node =
        pending.kind === 'device'
          ? (() => {
              const created = createDeviceNode(pending.deviceKey, position);
              // تجهیزی که از فهرست مانیتورینگ اضافه می‌شود، نام/مدل/IP و شناسهٔ
              // همان تجهیز را با خود می‌برد تا وضعیت زنده و همگام‌سازی ممکن باشد.
              const device = pending.deviceId ? devicesById.get(pending.deviceId) : null;
              return {
                ...created,
                data: {
                  ...created.data,
                  ...(pending.label ? { label: pending.label } : {}),
                  ...(pending.model ? { model: pending.model } : {}),
                  ...(pending.deviceId ? { deviceId: pending.deviceId } : {}),
                  ...(device
                    ? { ip: device.ip, syncedAt: Date.now(), serial: device.serial || created.data.serial }
                    : {}),
                },
              };
            })()
          : pending.kind === 'shape'
            ? createShapeNode(pending.shape, position)
            : pending.kind === 'group'
              ? createGroupNode(position)
              : pending.kind === 'image'
                ? createImageNode(position, { src: pending.src, attachmentId: pending.attachmentId })
                : pending.kind === 'diagram'
                  ? createDiagramLinkNode(position, {
                      diagramId: pending.diagramId,
                      label: pending.label,
                      description: pending.description,
                    })
                  : createNoteNode(position);
      applyCanvas((prev) => ({
        ...prev,
        nodes: [...prev.nodes.map((item) => ({ ...item, selected: false })), { ...node, selected: true }],
      }));
      setPending(null);
      setTool('select');
    },
    [applyCanvas, devicesById, editing, pending]
  );

  /** کلیک روی بوم: در حالت اتصال، انتخاب مبدأ را لغو می‌کند. */
  const handlePaneClickAt = useCallback(
    (position: { x: number; y: number }) => {
      if (tool === 'connect') {
        setLinkSource(null);
        return;
      }
      addAt(position);
    },
    [addAt, tool]
  );

  /** افزودن تجهیزی که از نوار ابزار روی بوم کشیده و رها شده است */
  const dropDeviceOnCanvas = useCallback(
    (payload: DiagramDeviceDragPayload, position: { x: number; y: number }) => {
      if (!editing) return;
      const created = createDeviceNode(payload.deviceKey, position);
      const device = payload.deviceId ? (devicesById.get(payload.deviceId) ?? null) : null;
      const node: DiagramFlowNode = {
        ...created,
        data: {
          ...created.data,
          ...(payload.label ? { label: payload.label } : {}),
          ...(payload.model ? { model: payload.model } : {}),
          ...(payload.deviceId ? { deviceId: payload.deviceId } : {}),
          ...(device ? { ip: device.ip, syncedAt: Date.now(), serial: device.serial || created.data.serial } : {}),
        },
      };
      applyCanvas((prev) => ({
        ...prev,
        nodes: [...prev.nodes.map((item) => ({ ...item, selected: false })), { ...node, selected: true }],
      }));
      setPending(null);
      setTool('select');
    },
    [applyCanvas, devicesById, editing]
  );

  const patchNodeData = useCallback(
    (nodeId: string, patch: Partial<DiagramNodeData>) => {
      applyCanvas((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node)),
      }));
    },
    [applyCanvas]
  );

  const patchNodeSize = useCallback(
    (nodeId: string, patch: { width?: number; height?: number }) => {
      applyCanvas((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
      }));
    },
    [applyCanvas]
  );

  const patchEdge = useCallback(
    (edgeId: string, patch: Partial<DiagramEdgeData>) => {
      applyCanvas((prev) => ({
        ...prev,
        edges: prev.edges.map((edge) =>
          edge.id === edgeId ? { ...edge, data: { ...(edge.data ?? { kind: 'copper', label: '' }), ...patch } } : edge
        ),
      }));
    },
    [applyCanvas]
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      applyCanvas((prev) => ({
        nodes: prev.nodes.filter((node) => node.id !== nodeId),
        edges: prev.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      }));
    },
    [applyCanvas]
  );

  const removeEdge = useCallback(
    (edgeId: string) => {
      applyCanvas((prev) => ({ ...prev, edges: prev.edges.filter((edge) => edge.id !== edgeId) }));
    },
    [applyCanvas]
  );

  const toggleGroup = useCallback(
    (nodeId: string) => {
      const group = canvas.snapshot().nodes.find((item) => item.id === nodeId);
      if (!group || group.type !== 'group') return;
      patchNodeData(nodeId, { collapsed: !group.data.collapsed });
    },
    [canvas, patchNodeData]
  );

  const deleteSelection = useCallback(() => {
    const nodeIds = new Set(
      canvas
        .snapshot()
        .nodes.filter((node) => node.selected)
        .map((node) => node.id)
    );
    const edgeIds = new Set(
      canvas
        .snapshot()
        .edges.filter((edge) => edge.selected)
        .map((edge) => edge.id)
    );
    if (!nodeIds.size && !edgeIds.size) return;
    applyCanvas((prev) => ({
      nodes: prev.nodes.filter((node) => !nodeIds.has(node.id)),
      edges: prev.edges.filter(
        (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)
      ),
    }));
  }, [applyCanvas, canvas]);

  /* ---------- تراز، توزیع و رنگ گروهی ---------- */

  const alignSelection = useCallback(
    (mode: AlignMode) => {
      const changed = applyCanvas((prev) => ({ ...prev, nodes: alignNodes(prev.nodes, mode) }));
      if (!changed) push('برای تراز، حداقل دو جزء را انتخاب کنید.', 'info');
    },
    [applyCanvas, push]
  );

  const distributeSelection = useCallback(
    (axis: 'x' | 'y') => {
      const changed = applyCanvas((prev) => ({ ...prev, nodes: distributeNodes(prev.nodes, axis) }));
      if (!changed) push('برای توزیع، حداقل سه جزء را انتخاب کنید.', 'info');
    },
    [applyCanvas, push]
  );

  const recolorSelection = useCallback(
    (color: string) => {
      applyCanvas((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => (node.selected ? { ...node, data: { ...node.data, color } } : node)),
      }));
    },
    [applyCanvas]
  );

  /* ---------- کلیپ‌بورد ---------- */

  const copySelection = useCallback(() => {
    const snapshot = canvas.snapshot();
    const count = copyToClipboard(
      snapshot.nodes.filter((node) => node.selected),
      snapshot.edges
    );
    setClipCount(clipboardCount());
    if (!count) {
      push('برای کپی، ابتدا یک یا چند جزء را انتخاب کنید.', 'info');
      return;
    }
    push(`${faDigits(count)} جزء کپی شد.`, 'success');
  }, [canvas, push]);

  const pasteClipboard = useCallback(() => {
    const pasted = pasteFromClipboard();
    if (!pasted) {
      push('چیزی برای چسباندن نیست (یا کلیپ‌بورد منقضی شده است).', 'info');
      return;
    }
    applyCanvas((prev) => ({
      nodes: [...prev.nodes.map((node) => ({ ...node, selected: false })), ...pasted.nodes],
      edges: [...prev.edges.map((edge) => ({ ...edge, selected: false })), ...pasted.edges],
    }));
    push(`${faDigits(pasted.nodes.length)} جزء چسبانده شد.`, 'success');
  }, [applyCanvas, push]);

  const cutSelection = useCallback(() => {
    const snapshot = canvas.snapshot();
    const count = copyToClipboard(
      snapshot.nodes.filter((node) => node.selected),
      snapshot.edges
    );
    if (!count) return;
    setClipCount(clipboardCount());
    deleteSelection();
    push(`${faDigits(count)} جزء بریده شد.`, 'success');
  }, [canvas, deleteSelection, push]);

  const duplicateSelection = useCallback(() => {
    const snapshot = canvas.snapshot();
    const count = copyToClipboard(
      snapshot.nodes.filter((node) => node.selected),
      snapshot.edges
    );
    if (!count) {
      push('برای تکثیر، ابتدا یک یا چند جزء را انتخاب کنید.', 'info');
      return;
    }
    setClipCount(clipboardCount());
    const pasted = pasteFromClipboard(24);
    if (!pasted) return;
    applyCanvas((prev) => ({
      nodes: [...prev.nodes.map((node) => ({ ...node, selected: false })), ...pasted.nodes],
      edges: [...prev.edges.map((edge) => ({ ...edge, selected: false })), ...pasted.edges],
    }));
  }, [applyCanvas, canvas, push]);

  /* ---------- جابه‌جایی دقیق ---------- */

  const nudgeSelection = useCallback(
    (dx: number, dy: number) => {
      const snapshot = canvas.snapshot();
      if (!snapshot.nodes.some((node) => node.selected)) return;
      if (!nudgeSnapshot.current) {
        nudgeSnapshot.current = snapshot;
        canvas.pushSnapshot(snapshot);
      }
      if (nudgeTimer.current != null) window.clearTimeout(nudgeTimer.current);
      nudgeTimer.current = window.setTimeout(() => {
        nudgeSnapshot.current = null;
      }, 700);
      const round = (value: number) => (snapToGrid ? Math.round(value / 10) * 10 : value);
      // گام واگرد یک‌بار در آغاز رشتهٔ کلیدها ثبت شد؛ ادامهٔ حرکت گام تازه نمی‌سازد.
      const changed = canvas.apply(
        (prev) => ({
          ...prev,
          nodes: prev.nodes.map((node) =>
            node.selected
              ? { ...node, position: { x: round(node.position.x + dx), y: round(node.position.y + dy) } }
              : node
          ),
        }),
        false
      );
      if (changed) markDirty();
    },
    [canvas, markDirty, snapToGrid]
  );

  /* ---------- کشیدن و رها کردن ---------- */

  const beginDrag = useCallback(() => {
    dragSnapshot.current = canvas.snapshot();
    setDragging(true);
  }, [canvas, setDragging]);

  const endDrag = useCallback(() => {
    setDragging(false);
    const before = dragSnapshot.current;
    dragSnapshot.current = null;
    if (!before) return;
    // فقط اگر موقعیت واقعاً عوض شده باشد یک گام واگرد ثبت می‌شود.
    const after = canvas.snapshot();
    if (before.nodes !== after.nodes) canvas.pushSnapshot(before);
  }, [canvas, setDragging]);

  const connectHint = linkSource
    ? 'روی تجهیز دوم کلیک کنید تا ارتباط ساخته شود.'
    : 'روی تجهیز اول کلیک کنید؛ سپس تجهیز دوم.';
  const pendingHint = !pending
    ? null
    : pending.kind === 'device'
      ? pending.label
        ? `روی بوم کلیک کنید تا «${pending.label}» اضافه شود.`
        : 'روی بوم کلیک کنید تا تجهیز اضافه شود.'
      : pending.kind === 'group'
        ? 'روی بوم کلیک کنید تا کادر گروه اضافه شود.'
        : pending.kind === 'shape'
          ? pending.shape === 'circle'
            ? 'روی بوم کلیک کنید تا دایره اضافه شود.'
            : 'روی بوم کلیک کنید تا مستطیل اضافه شود.'
          : pending.kind === 'image'
            ? 'روی بوم کلیک کنید تا تصویر اضافه شود.'
            : pending.kind === 'diagram'
              ? `روی بوم کلیک کنید تا پیوند به «${pending.label}» اضافه شود.`
              : 'روی بوم کلیک کنید تا یادداشت اضافه شود.';

  return {
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
  };
}
