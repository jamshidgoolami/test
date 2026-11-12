import { useContext, useMemo } from 'react';
import { BaseEdge, useInternalNode } from '@xyflow/react';
import type { EdgeProps, EdgeTypes, InternalNode } from '@xyflow/react';

import { connectionType } from '../../../lib/diagrams';
import type { DiagramFlowEdge, DiagramFlowNode } from '../../../lib/diagrams';
import { computeLink } from '../../../lib/diagram-geometry';
import type { LinkRect } from '../../../lib/diagram-geometry';
import type { DiagramConnectionKind } from '../../../lib/types';
import { TOOL_CONTEXT } from './toolContext';

function rectOf(node: InternalNode<DiagramFlowNode> | undefined): LinkRect | null {
  if (!node) return null;
  const point = node.internals.positionAbsolute;
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  if (!width || !height) return null;
  return { x: point.x, y: point.y, width, height };
}

function ConnectionEdge({ id, source, target, data, selected }: EdgeProps<DiagramFlowEdge>) {
  const { exporting, highlightNodeId } = useContext(TOOL_CONTEXT);
  const sourceNode = useInternalNode<DiagramFlowNode>(source);
  const targetNode = useInternalNode<DiagramFlowNode>(target);
  const active = selected && !exporting;
  const meta = connectionType(data?.kind as DiagramConnectionKind | undefined);
  // مسیر از هندسهٔ خود گره‌ها ساخته می‌شود، پس لنگر ثابت و کشیدن دسته لازم نیست.
  const link = useMemo(() => {
    const a = rectOf(sourceNode);
    const b = rectOf(targetNode);
    if (!a || !b) return null;
    return computeLink(a, b);
  }, [sourceNode, targetNode]);
  if (!link) return null;
  const path = link.path;
  const dimmed = !!highlightNodeId && highlightNodeId !== source && highlightNodeId !== target;
  const width = active ? meta.width + 1.5 : meta.width;
  return (
    <>
      {/* هالهٔ سفید زیر خط، ارتباط را روی پس‌زمینهٔ شلوغ خوانا نگه می‌دارد. */}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={26}
        style={{
          stroke: 'rgb(var(--nw-surface))',
          strokeWidth: width + (dimmed ? 2.5 : 3.5),
          opacity: dimmed ? 0.3 : 0.94,
        }}
      />
      {/* بدون برچسب و فلش: نوع ارتباط فقط با رنگ/الگوی خط و راهنمای رنگ خوانده می‌شود. */}
      <path
        d={path}
        fill="none"
        stroke={meta.color}
        strokeWidth={width}
        strokeDasharray={meta.dash || undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
        opacity={dimmed ? 0.16 : 1}
        style={{
          filter: active ? `drop-shadow(0 0 3px ${meta.color}66)` : undefined,
          transition: 'opacity 120ms ease',
        }}
      />
      {/* نقطهٔ اتصال در دو سر خط: محل نشستن خط روی تجهیز تمیز و خوانا می‌شود. */}
      {[link.start, link.end].map((point, index) => (
        <circle
          key={index}
          cx={Math.round(point.x * 10) / 10}
          cy={Math.round(point.y * 10) / 10}
          r={3.4}
          fill="rgb(var(--nw-surface))"
          stroke={meta.color}
          strokeWidth={1.7}
          opacity={dimmed ? 0.2 : 1}
          pointerEvents="none"
        />
      ))}
    </>
  );
}


export const diagramEdgeTypes = {
  diagram: ConnectionEdge,
} satisfies EdgeTypes;
