import { createContext } from 'react';
import type { Device } from '../../../lib/types';

export const EMPTY_DEVICES = new Map<number, Device>();

export type ZoomLevel = 'far' | 'mid' | 'near';

export const TOOL_CONTEXT = createContext({
  editing: false,
  connectable: false,
  placing: false,
  exporting: false,
  zoomLevel: 'mid' as ZoomLevel,
  highlightNodeId: null as string | null,
  devices: EMPTY_DEVICES,
  onOpenDevice: (_id: number) => {},
  onOpenDiagram: (_id: number) => {},
  onToggleGroup: (_id: string) => {},
  linkSourceId: null as string | null,
});
