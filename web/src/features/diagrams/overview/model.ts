import { createContext } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { DiagramConnectionKind, DiagramGraphItem } from '../../../lib/types';

export type OverviewNodeData = {
  name: string;
  description: string;
  nodeCount: number;
  edgeCount: number;
  childCount: number;
  inLinks: number;
  outLinks: number;
  brokenLinks: number;
  updatedAt: number;
  current: boolean;
  dimmed: boolean;
  connectable: boolean;
  compact: boolean;
  highlighted: boolean;
  matched: boolean;
  connectSource: boolean;
};

export type OverviewNode = Node<OverviewNodeData, 'overview'>;

export type OverviewEdgeData = {
  kind?: DiagramConnectionKind;
  label?: string;
  nodeLabel?: string;
  tree?: boolean;
  highlight?: boolean;
  showLabel?: boolean;
};

export type OverviewEdge = Edge<OverviewEdgeData, 'overview'>;

export const OverviewUi = createContext<{ open: (id: number) => void }>({ open: () => undefined });

export interface Placed extends DiagramGraphItem {
  x: number;
  y: number;
}

export type PositionMap = Record<number, { x: number; y: number }>;

export interface LayoutPrefs {
  auto: boolean;
  positions: PositionMap;
}

export const NODE_W = 240;
export const NODE_H = 118;
export const COL_GAP = 96;
export const ROW_GAP = 28;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.2;
/** فاصلهٔ نوار «بدون ارتباط» از گراف اصلی */
export const ORPHAN_GAP = 110;
/** زیر این زوم کارت‌ها فشرده می‌شوند تا متن خوانا بماند */
export const COMPACT_ZOOM = 0.62;
/** نسخهٔ تازه: هندسه/اندازهٔ کارت‌ها عوض شده و چیدمان قدیمی می‌تواند روی هم بیفتد. */
export const LAYOUT_KEY = 'nw.diagrams.overview.layout.v2';
