// 分→時刻文字列
export const minToTime = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// 時刻文字列→分
export const timeToMin = (time: string): number => {
  const [h, m] = time.split(':').map(v => parseInt(v, 10));
  return h * 60 + m;
};

// 日付フォーマット (YYYY-MM-DD)
export const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// 同じ日付かどうか
export const isSameDate = (date1: Date, date2: Date): boolean => {
  return formatDate(date1) === formatDate(date2);
};

// 週の開始日を取得
export const getWeekStart = (date: Date, startDay: number): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

// 2週間期間の開始日を取得
export const getBiweeklyPeriodStart = (date: Date, startDay: number): Date => {
  const epoch = new Date(1970, 0, 1);
  const epochDay = epoch.getDay();
  const daysToFirstWeekStart = (startDay - epochDay + 7) % 7;
  const firstWeekStart = new Date(1970, 0, 1 + daysToFirstWeekStart);
  const targetWeekStart = getWeekStart(date, startDay);
  const diffMs = targetWeekStart.getTime() - firstWeekStart.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  const periodWeeks = Math.floor(diffWeeks / 2) * 2;
  const periodStart = new Date(firstWeekStart);
  periodStart.setDate(periodStart.getDate() + periodWeeks * 7);
  return periodStart;
};

// カレンダー用の日付配列を生成
export const getCalendarDays = (baseDate: Date): Date[] => {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const days: Date[] = [];
  
  for (let i = startOffset; i > 0; i--) {
    days.push(new Date(year, month, 1 - i));
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push(new Date(year, month + 1, i));
  }
  return days;
};

// 週の日付配列を生成
export const getWeekDays = (baseDate: Date): Date[] => {
  const startOfWeek = new Date(baseDate);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });
};

// 24時間のラベル配列を生成
export const getHourLabels = (): string[] => {
  return Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);
};

// 曜日名
export const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];