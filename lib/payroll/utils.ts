import { Timestamp } from 'firebase/firestore';
import JapaneseHolidays from 'japanese-holidays';

// 時刻フォーマット
export const formatTime = (ts?: Timestamp): string => {
  return ts ? ts.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '--:--';
};

// 曜日を取得
export const getDayOfWeek = (date: Date): string => {
  return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
};

// 曜日の色を取得
export const getDayOfWeekColor = (date: Date): string => {
  const day = date.getDay();
  const holiday = JapaneseHolidays.isHoliday(date);
  if (holiday || day === 0) return 'text-red-600';
  if (day === 6) return 'text-blue-600';
  return 'text-gray-900';
};

// グラフバーの色を取得
export const getBarColor = (status: string): string => {
  switch (status) {
    case 'approved': return '#10b981';
    case 'pending': return '#f59e0b';
    case 'rejected': return '#ef4444';
    default: return '#9ca3af';
  }
};

// ステータスのスタイル
export const statusStyles: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

// ステータスのラベル
export const statusLabels: Record<string, string> = {
  draft: '下書き',
  pending: '申請中',
  approved: '承認済',
  rejected: '却下',
};

// アバターURL生成関数
export const getAvatarUrl = (seed: string, bgColor?: string): string => {
  const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
  const params = bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear';
  return `${base}${params}&fontWeight=700&radius=50`;
};

// 月のdateKey範囲を取得
export const getMonthDateKeyRange = (selectedMonth: Date): { startKey: string; endKey: string } => {
  const y = selectedMonth.getFullYear();
  const m = selectedMonth.getMonth();
  const startKey = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const endY = m === 11 ? y + 1 : y;
  const endM = m === 11 ? 0 : m + 1;
  const endKey = `${endY}-${String(endM + 1).padStart(2, '0')}-01`;
  return { startKey, endKey };
};

// dateKeyからDateを生成
export const dateKeyToDate = (dateKey: string): Date => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// 時刻文字列をTimestampに変換
export const timeToTimestamp = (dateKey: string, timeStr: string): Timestamp | null => {
  if (!timeStr) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  return Timestamp.fromDate(new Date(year, month - 1, day, hour, minute));
};

// CSV出力
export const exportPayrollCsv = (
  timecards: Array<{
    dateKey: string;
    clockInAt?: Timestamp;
    clockOutAt?: Timestamp;
    hourlyWage?: number;
  }>,
  calcBreakdownFn: (tc: any) => {
    breakMin: number;
    totalMin: number;
    nightMin: number;
    overtimeMin: number;
    base: number;
    night: number;
    overtime: number;
    holiday: number;
    transport: number;
    total: number;
  },
  defaultHourlyWage: number,
  selectedMonth: Date
): void => {
  const header = ['日付', '出勤', '退勤', '休憩(分)', '時間(分)', '夜間(分)', '残業(分)', '時給', '基本(円)', '深夜(円)', '残業(円)', '休日(円)', '交通費(円)', '合計(円)'];
  const lines = [header.join(',')];

  timecards.forEach(tc => {
    const bd = calcBreakdownFn(tc);
    const hourly = tc.hourlyWage ?? defaultHourlyWage;
    lines.push([
      tc.dateKey,
      formatTime(tc.clockInAt),
      formatTime(tc.clockOutAt),
      String(bd.breakMin || 0),
      String(bd.totalMin),
      String(bd.nightMin),
      String(bd.overtimeMin),
      String(hourly),
      String(Math.round(bd.base)),
      String(Math.round(bd.night)),
      String(Math.round(bd.overtime)),
      String(Math.round(bd.holiday)),
      String(Math.round(bd.transport)),
      String(bd.total),
    ].join(','));
  });

  const csv = '\ufeff' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const y = selectedMonth.getFullYear();
  const m = selectedMonth.getMonth() + 1;
  a.download = `payroll_${y}-${String(m).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
