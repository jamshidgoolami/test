import { BaseEdge, EdgeLabelRenderer, useInternalNode } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { connectionType } from '../../../lib/diagrams';
import { NODE_H, NODE_W, type OverviewEdge, type OverviewNode } from './model';

export type NodeGeometry = {
  internals: { positionAbsolute: { x: number; y: number } };
  measured?: { width?: number; height?: number };
};

/** مرکز و شعاع‌های کادر گره برای محاسبهٔ برخورد خط با بیضی. */
export function ellipseOf(node: NodeGeometry | undefined) {
  if (!node) return null;
  const width = node.measured?.width || NODE_W;
  const height = node.measured?.height || NODE_H;
  if (width <= 0 || height <= 0) return null;
  return {
    cx: node.internals.positionAbsolute.x + width / 2,
    cy: node.internals.positionAbsolute.y + height / 2,
    rx: width / 2,
    ry: height / 2,
  };
}

export function OverviewLinkEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  style,
  markerEnd,
}: EdgeProps<OverviewEdge>) {
  const sourceNode = useInternalNode<OverviewNode>(source);
  const targetNode = useInternalNode<OverviewNode>(target);
  const sourceShape = ellipseOf(sourceNode);
  const targetShape = ellipseOf(targetNode);

  // نقطهٔ برخورد خط مرکز‑به‑مرکز با بیضی هر کارت. بنابراین خط از هر زاویه‌ای
  // که دو کارت نسبت به هم دارند، دقیقاً روی محیط بیضی شروع و تمام می‌شود.
  let sx = sourceX;
  let sy = sourceY;
  let tx = targetX;
  let ty = targetY;
  if (sourceShape && targetShape) {
    const dx = targetShape.cx - sourceShape.cx;
    const dy = targetShape.cy - sourceShape.cy;
    const distance = Math.hypot(dx, dy);
    if (distance > 1) {
      const ux = dx / distance;
      const uy = dy / distance;
      const sourceT = 1 / (Math.hypot(dx / sourceShape.rx, dy / sourceShape.ry) || 1);
      const targetT = 1 / (Math.hypot(dx / targetShape.rx, dy / targetShape.ry) || 1);
      const gap = 4;
      sx = sourceShape.cx + dx * sourceT + ux * gap;
      sy = sourceShape.cy + dy * sourceT + uy * gap;
      tx = targetShape.cx - dx * targetT - ux * gap;
      ty = targetShape.cy - dy * targetT - uy * gap;
    }
  }

  const path = `M ${sx.toFixed(2)},${sy.toFixed(2)} L ${tx.toFixed(2)},${ty.toFixed(2)}`;
  const tree = !!data?.tree;
  // برچسب خطوط بلند نزدیک مقصد می‌نشیند تا روی کارت‌های میانی نیفتد.
  const span = Math.hypot(tx - sx, ty - sy);
  const labelT = span > 260 ? 0.84 : 0.5;
  let labelX = sx + (tx - sx) * labelT;
  let labelY = sy + (ty - sy) * labelT;
  // در فاصله‌های کوتاه، برچسب کمی از خط فاصله می‌گیرد تا فلش و خط پنهان نشوند.
  if (!tree && span > 1 && span < 150) {
    const offset = 16;
    labelX += (-(ty - sy) / span) * offset;
    labelY += ((tx - sx) / span) * offset;
  }
  const width = Number(style?.strokeWidth ?? 2);
  const customLabel = data?.label?.trim();
  const label = customLabel || (selected && data?.kind ? connectionType(data.kind).label : '');
  const showLabel = !tree && Boolean(label) && (Boolean(selected) || Boolean(data?.showLabel));
  return (
    <>
      {!tree && selected ? (
        <path
          d={path}
          fill="none"
          stroke="rgb(var(--nw-surface))"
          strokeWidth={width + 6}
          strokeLinecap="round"
          opacity={0.95}
        />
      ) : null}
      <BaseEdge id={id} path={path} style={style} interactionWidth={tree ? 0 : 26} markerEnd={markerEnd} />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            dir="rtl"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
            className={`max-w-[170px] truncate rounded-pill border bg-surface/95 px-2 py-0.5 text-[9.5px] shadow-soft ${
              selected || data?.highlight ? 'border-sky-300 text-ink-700' : 'border-ink-200 text-ink-500'
            }`}
            title={label}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
