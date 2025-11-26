export type ViewMode = 'day' | 'week' | 'month';
export type StatusFilter = 'all' | 'approved' | 'pending' | 'rejected';
export type SubmissionCycle = 'weekly' | 'biweekly' | 'monthly';

export interface ShiftEntry {
  id?: string;
  date: string;
  startTime: string;
  endTime: string;
  note?: string;
  persisted?: boolean;
  status?: string;
}

export interface DragStartInfo {
  date: string;
  startY: number;
  startMin: number;
  startScrollY: number;
}

export interface TempShift {
  date: string;
  startTime: string;
  endTime: string;
}

export interface ResizingShift {
  id: string;
  edge: 'start' | 'end';
  originalStart: string;
  originalEnd: string;
  startY: number;
}

export interface OrgSettings {
  defaultHourlyWage: number;
  shiftSubmissionCycle: SubmissionCycle;
  weekStartDay: number;
  weeklyDeadlineDaysBefore: number;
  monthlyDeadlineDay: number;
}