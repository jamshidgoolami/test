import type { DiagramSummary } from '../../../lib/types';

export type Mode = 'view' | 'edit';
export type PanelTab = 'tree' | 'devices' | 'inspector';

export interface EditorDialog {
  mode: 'create' | 'edit';
  parentId?: number | null;
  diagram?: DiagramSummary;
}
