import { Timestamp } from 'firebase/firestore';

// 休憩期間の型
export interface BreakPeriod {
  startAt: Timestamp;
  endAt?: Timestamp;
}

// タイムカード行の型
export interface TimecardRow {
  id: string;
  userId?: string;
  dateKey: string;
  date: Date;
  clockInAt?: Timestamp;
  breaks: BreakPeriod[];
  clockOutAt?: Timestamp;
  hourlyWage?: number;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
}

// 月次レポートの型
export interface MonthlyReport {
  id?: string;
  organizationId: string;
  userId: string;
  userName: string;
  year: number;
  month: number;
  workDays: number;
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  totalNightMinutes: number;
  totalOvertimeMinutes: number;
  baseWage: number;
  nightPremium: number;
  overtimePremium: number;
  holidayPremium: number;
  transportAllowance: number;
  totalAmount: number;
  timecardCount: number;
  status: 'pending' | 'confirmed' | 'approved' | 'rejected';
  version: number;
  approvedAt?: Timestamp;
  approvedBy?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 組織設定の型
export interface OrgSettings {
  defaultHourlyWage: number;
  nightPremiumEnabled: boolean;
  nightPremiumRate: number;
  nightStart: string;
  nightEnd: string;
  overtimePremiumEnabled: boolean;
  overtimePremiumRate: number;
  overtimeDailyThresholdMinutes: number;
  holidayPremiumEnabled: boolean;
  holidayPremiumRate: number;
  holidayIncludesWeekend: boolean;
  transportAllowanceEnabled: boolean;
  transportAllowancePerShift: number;
}

// 給与内訳の型
export interface PayrollBreakdown {
  base: number;
  night: number;
  overtime: number;
  holiday: number;
  transport: number;
  total: number;
  totalMin: number;
  nightMin: number;
  overtimeMin: number;
  breakMin: number;
  hourly: number;
}

// サマリーの型
export interface PayrollSummary {
  days: number;
  totalMin: number;
  nightMin: number;
  overtimeMin: number;
  base: number;
  night: number;
  overtime: number;
  holiday: number;
  transport: number;
  total: number;
  allApproved: boolean;
}

// 日付でグループ化されたタイムカード
export interface GroupedTimecard {
  dateKey: string;
  date: Date;
  timecards: TimecardRow[];
  totalBreakdown: PayrollBreakdown;
}

// グラフ用データの型
export interface ChartDataItem {
  day: number;
  hours: number;
  status: string;
}

// ユーザー申請の型（company/payroll用）
export interface UserApplication {
  userId: string;
  userName: string;
  avatarUrl: string;
  timecards: TimecardRow[];
  workDays: number;
  totalMinutes: number;
  breakMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  base: number;
  night: number;
  overtime: number;
  holiday: number;
  transport: number;
  total: number;
}

// ユーザー情報の型
export interface UserInfo {
  name: string;
  seed?: string;
  bgColor?: string;
}
