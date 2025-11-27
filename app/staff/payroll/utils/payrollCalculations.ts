import { Timestamp } from 'firebase/firestore';
import JapaneseHolidays from 'japanese-holidays';
import { BreakPeriod, TimecardRow, OrgSettings, PayrollBreakdown, PayrollSummary, GroupedTimecard, ChartDataItem } from '../types';

// タイムスタンプ間の分数計算
export const minutesBetweenTimestamps = (start?: Timestamp, end?: Timestamp): number => {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.toMillis() - start.toMillis()) / 60000));
};

// 複数休憩の合計時間を計算
export const calcTotalBreakMinutes = (breaks: BreakPeriod[]): number => {
  if (!breaks || breaks.length === 0) return 0;
  let total = 0;
  for (const b of breaks) {
    if (b.startAt && b.endAt) {
      total += Math.max(0, Math.round((b.endAt.toMillis() - b.startAt.toMillis()) / 60000));
    }
  }
  return total;
};

// 深夜時間の計算
export const calcNightMinutes = (
  clockIn?: Timestamp,
  clockOut?: Timestamp,
  nightStart?: string,
  nightEnd?: string
): number => {
  if (!clockIn || !clockOut || !nightStart || !nightEnd) return 0;
  const start = clockIn.toDate();
  const end = clockOut.toDate();
  const [nsH, nsM] = nightStart.split(':').map(Number);
  const [neH, neM] = nightEnd.split(':').map(Number);
  let total = 0;
  let cur = new Date(start);
  while (cur < end) {
    const h = cur.getHours();
    const m = cur.getMinutes();
    const dayMin = h * 60 + m;
    const nsMin = nsH * 60 + nsM;
    const neMin = neH * 60 + neM;
    let isNight = false;
    if (nsMin <= neMin) {
      isNight = dayMin >= nsMin && dayMin < neMin;
    } else {
      isNight = dayMin >= nsMin || dayMin < neMin;
    }
    if (isNight) total++;
    cur = new Date(cur.getTime() + 60000);
  }
  return total;
};

// タイムカード1件の内訳計算
export const calcBreakdown = (
  row: TimecardRow,
  orgSettings: OrgSettings | null,
  transportPerShift: number
): PayrollBreakdown => {
  const hourly = row.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
  const grossMin = minutesBetweenTimestamps(row.clockInAt, row.clockOutAt);
  const breakMin = calcTotalBreakMinutes(row.breaks);
  const totalMin = Math.max(0, grossMin - breakMin);
  const totalH = totalMin / 60;
  const base = hourly * totalH;

  const nightMin = orgSettings?.nightPremiumEnabled
    ? calcNightMinutes(row.clockInAt, row.clockOutAt, orgSettings.nightStart, orgSettings.nightEnd)
    : 0;
  const night = orgSettings?.nightPremiumEnabled
    ? hourly * (nightMin / 60) * (orgSettings.nightPremiumRate ?? 0)
    : 0;

  const overtimeMin = orgSettings?.overtimePremiumEnabled
    ? Math.max(0, totalMin - (orgSettings.overtimeDailyThresholdMinutes ?? 480))
    : 0;
  const overtime = orgSettings?.overtimePremiumEnabled
    ? hourly * (overtimeMin / 60) * (orgSettings.overtimePremiumRate ?? 0)
    : 0;

  const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
  const isHoliday = (d: Date) => !!JapaneseHolidays.isHoliday(d);
  const isHol = !!orgSettings?.holidayPremiumEnabled &&
    ((orgSettings?.holidayIncludesWeekend && isWeekend(row.date)) || isHoliday(row.date));
  const holiday = isHol ? hourly * totalH * (orgSettings?.holidayPremiumRate ?? 0) : 0;

  const transport = orgSettings?.transportAllowanceEnabled
    ? (transportPerShift || orgSettings.transportAllowancePerShift || 0)
    : 0;

  const total = Math.round(base + night + overtime + holiday + transport);

  return { base, night, overtime, holiday, transport, total, totalMin, nightMin, overtimeMin, breakMin, hourly };
};

// サマリー計算
export const calcSummary = (
  timecards: TimecardRow[],
  orgSettings: OrgSettings | null,
  transportPerShift: number
): PayrollSummary => {
  const uniqueDays = new Set<string>();
  let totalMin = 0, nightMin = 0, overtimeMin = 0;
  let base = 0, night = 0, overtime = 0, holiday = 0, transport = 0, total = 0;

  for (const tc of timecards) {
    uniqueDays.add(tc.dateKey);
    const bd = calcBreakdown(tc, orgSettings, transportPerShift);
    totalMin += bd.totalMin;
    nightMin += bd.nightMin;
    overtimeMin += bd.overtimeMin;
    base += bd.base;
    night += bd.night;
    overtime += bd.overtime;
    holiday += bd.holiday;
    transport += bd.transport;
    total += bd.total;
  }

  const allApproved = timecards.length > 0 && timecards.every(t => t.status === 'approved');

  return { days: uniqueDays.size, totalMin, nightMin, overtimeMin, base, night, overtime, holiday, transport, total, allApproved };
};

// 日付でグループ化
export const groupTimecardsByDate = (
  timecards: TimecardRow[],
  orgSettings: OrgSettings | null,
  transportPerShift: number
): GroupedTimecard[] => {
  const groupMap = new Map<string, TimecardRow[]>();

  for (const tc of timecards) {
    const existing = groupMap.get(tc.dateKey) || [];
    existing.push(tc);
    groupMap.set(tc.dateKey, existing);
  }

  const groups: GroupedTimecard[] = [];

  for (const [dateKey, cards] of groupMap.entries()) {
    // グループ内の合計を計算
    let totalBreakdown: PayrollBreakdown = {
      base: 0, night: 0, overtime: 0, holiday: 0, transport: 0, total: 0,
      totalMin: 0, nightMin: 0, overtimeMin: 0, breakMin: 0, hourly: 0
    };

    for (const tc of cards) {
      const bd = calcBreakdown(tc, orgSettings, transportPerShift);
      totalBreakdown.base += bd.base;
      totalBreakdown.night += bd.night;
      totalBreakdown.overtime += bd.overtime;
      totalBreakdown.holiday += bd.holiday;
      totalBreakdown.transport += bd.transport;
      totalBreakdown.total += bd.total;
      totalBreakdown.totalMin += bd.totalMin;
      totalBreakdown.nightMin += bd.nightMin;
      totalBreakdown.overtimeMin += bd.overtimeMin;
      totalBreakdown.breakMin += bd.breakMin;
    }

    // 最初のカードから時給を取得（表示用）
    totalBreakdown.hourly = cards[0]?.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;

    groups.push({
      dateKey,
      date: cards[0].date,
      timecards: cards.sort((a, b) => {
        const aTime = a.clockInAt?.toMillis() ?? 0;
        const bTime = b.clockInAt?.toMillis() ?? 0;
        return aTime - bTime;
      }),
      totalBreakdown
    });
  }

  return groups.sort((a, b) => a.date.getTime() - b.date.getTime());
};

// グラフ用データ生成
export const generateChartData = (
  groupedTimecards: GroupedTimecard[]
): ChartDataItem[] => {
  return groupedTimecards.map(group => {
    const dayNum = parseInt(group.dateKey.split('-')[2], 10);
    // グループ内のステータスを決定（最も優先度の高いものを選択）
    const statuses = group.timecards.map(tc => tc.status);
    let status = 'draft';
    if (statuses.includes('approved')) status = 'approved';
    else if (statuses.includes('pending')) status = 'pending';
    else if (statuses.includes('rejected')) status = 'rejected';

    return {
      day: dayNum,
      hours: parseFloat((group.totalBreakdown.totalMin / 60).toFixed(1)),
      status
    };
  });
};

// 休憩が完了しているかチェック
export const isBreakComplete = (breaks: BreakPeriod[]): boolean => {
  if (breaks.length === 0) return true;
  const lastBreak = breaks[breaks.length - 1];
  return !!lastBreak.endAt;
};

// 打刻完了のドラフトカードを取得
export const getCompletedDraftCards = (timecards: TimecardRow[]): TimecardRow[] => {
  return timecards.filter(t =>
    t.status === 'draft' &&
    t.clockInAt &&
    t.clockOutAt &&
    isBreakComplete(t.breaks)
  );
};

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

// CSV出力
export const exportPayrollCsv = (
  timecards: TimecardRow[],
  orgSettings: OrgSettings | null,
  transportPerShift: number,
  selectedMonth: Date
): void => {
  const header = ['日付', '出勤', '退勤', '休憩(分)', '時間(分)', '夜間(分)', '残業(分)', '時給', '基本(円)', '深夜(円)', '残業(円)', '休日(円)', '交通費(円)', '合計(円)'];
  const lines = [header.join(',')];

  timecards.forEach(tc => {
    const bd = calcBreakdown(tc, orgSettings, transportPerShift);
    const hourly = tc.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
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
  a.download = `my_payroll_${y}-${String(m).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};