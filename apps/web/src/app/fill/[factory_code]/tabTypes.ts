import type { Factory, EmissionSource, ActivityRecord } from './page';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface TabProps {
  factory: Factory;
  year: number;
  emissionSources: EmissionSource[];
  selectedSourceIds: Set<string>;
  existingRecords: ActivityRecord[];
  setActiveTab: (tab: string) => void;
}

export const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export const HEADER_BG = '#0C3D2E';
export const BTN_BG = '#0C3D2E';
