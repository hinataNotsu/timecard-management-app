import { Timestamp } from 'firebase/firestore';
import JapaneseHolidays from 'japanese-holidays';
import { BreakPeriod, TimecardRow, OrgSettings, PayrollBreakdown, PayrollSummary, GroupedTimecard, ChartDataItem } from './types';

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

// 特定の時刻が休憩中かどうかを判定
const isInBreak = (time: Date, breaks: BreakPeriod[]): boolean => {
  const timeMs = time.getTime();
  for (const b of breaks) {
    if (b.startAt && b.endAt) {
      const breakStart = b.startAt.toMillis();
      const breakEnd = b.endAt.toMillis();
      if (timeMs >= breakStart && timeMs < breakEnd) {
        return true;
      }
    }
  }
  return false;
};

// 深夜時間の計算（休憩時間を除外）
export const calcNightMinutes = (
  clockIn?: Timestamp,
  clockOut?: Timestamp,
  nightStart?: string,
  nightEnd?: string,
  breaks?: BreakPeriod[]
): number => {
  if (!clockIn || !clockOut || !nightStart || !nightEnd) return 0;
  const start = clockIn.toDate();
  const end = clockOut.toDate();
  const [nsH, nsM] = nightStart.split(':').map(Number);
  const [neH, neM] = nightEnd.split(':').map(Number);
  const breakList = breaks || [];
  let total = 0;
  let cur = new Date(start);
  while (cur < end) {
    // 休憩中は深夜時間にカウントしない
    if (!isInBreak(cur, breakList)) {
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
    }
    cur = new Date(cur.getTime() + 60000);
  }
  return total;
};

// 週末判定
export const isWeekend = (d: Date): boolean => d.getDay() === 0 || d.getDay() === 6;

// 祝日判定
export const isHoliday = (d: Date): boolean => !!JapaneseHolidays.isHoliday(d);

// タイムカード1件の内訳計算（交通費はシフト単位では含めない）
export const calcBreakdown = (
  row: TimecardRow,
  orgSettings: OrgSettings | null,
  _transportPerShift?: number // 使用しない（日単位で計算するため）
): PayrollBreakdown => {
  const hourly = row.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
  const grossMin = minutesBetweenTimestamps(row.clockInAt, row.clockOutAt);
  const breakMin = calcTotalBreakMinutes(row.breaks);
  const totalMin = Math.max(0, grossMin - breakMin);
  const totalH = totalMin / 60;
  const base = hourly * totalH;

  const nightMin = orgSettings?.nightPremiumEnabled
    ? calcNightMinutes(row.clockInAt, row.clockOutAt, orgSettings.nightStart, orgSettings.nightEnd, row.breaks)
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

  const isHol = !!orgSettings?.holidayPremiumEnabled &&
    ((orgSettings?.holidayIncludesWeekend && isWeekend(row.date)) || isHoliday(row.date));
  const holiday = isHol ? hourly * totalH * (orgSettings?.holidayPremiumRate ?? 0) : 0;

  // 交通費はシフト単位では含めない（日単位で1回だけ加算）
  const transport = 0;

  const total = Math.round(base + night + overtime + holiday + transport);

  return { base, night, overtime, holiday, transport, total, totalMin, nightMin, overtimeMin, breakMin, hourly };
};

// サマリー計算（交通費は出勤日数×交通費/日）
export const calcSummary = (
  timecards: TimecardRow[],
  orgSettings: OrgSettings | null,
  transportPerShift: number
): PayrollSummary => {
  const uniqueDays = new Set<string>();
  let totalMin = 0, nightMin = 0, overtimeMin = 0;
  let base = 0, night = 0, overtime = 0, holiday = 0, total = 0;

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
    total += bd.total;
  }

  // 交通費は出勤日数 × 交通費/日
  const dailyTransport = orgSettings?.transportAllowanceEnabled
    ? (transportPerShift || orgSettings.transportAllowancePerShift || 0)
    : 0;
  const transport = uniqueDays.size * dailyTransport;
  total += transport;

  const allApproved = timecards.length > 0 && timecards.every(t => t.status === 'approved');

  return { days: uniqueDays.size, totalMin, nightMin, overtimeMin, base, night, overtime, holiday, transport, total, allApproved };
};

// 日付でグループ化（交通費は日単位で1回だけ加算）
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

  // 日単位の交通費
  const dailyTransport = orgSettings?.transportAllowanceEnabled
    ? (transportPerShift || orgSettings.transportAllowancePerShift || 0)
    : 0;

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
      totalBreakdown.total += bd.total;
      totalBreakdown.totalMin += bd.totalMin;
      totalBreakdown.nightMin += bd.nightMin;
      totalBreakdown.overtimeMin += bd.overtimeMin;
      totalBreakdown.breakMin += bd.breakMin;
    }

    // 日単位で交通費を1回だけ加算
    totalBreakdown.transport = dailyTransport;
    totalBreakdown.total += dailyTransport;

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

// ユーザーごとに集計（company/payroll用）
export const aggregateByUser = (
  timecards: TimecardRow[],
  orgSettings: OrgSettings | null,
  memberTransport: Record<string, number>,
  userInfoMap: Record<string, { name: string; seed?: string; bgColor?: string }>,
  getAvatarUrl: (seed: string, bgColor?: string) => string
) => {
  const map = new Map<string, {
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
    uniqueDates: Set<string>;
  }>();

  for (const tc of timecards) {
    const userId = tc.userId || '';
    if (!map.has(userId)) {
      const info = userInfoMap[userId] || { name: userId };
      const seed = info.seed || info.name || userId;
      const bgColor = info.bgColor;

      map.set(userId, {
        userId,
        userName: info.name,
        avatarUrl: getAvatarUrl(seed, bgColor),
        timecards: [],
        workDays: 0,
        totalMinutes: 0,
        breakMinutes: 0,
        nightMinutes: 0,
        overtimeMinutes: 0,
        base: 0,
        night: 0,
        overtime: 0,
        holiday: 0,
        transport: 0,
        total: 0,
        uniqueDates: new Set<string>(),
      });
    }

    const app = map.get(userId)!;
    app.timecards.push(tc);
    app.uniqueDates.add(tc.dateKey);

    const bd = calcBreakdown(tc, orgSettings);
    app.totalMinutes += bd.totalMin;
    app.breakMinutes += bd.breakMin;
    app.nightMinutes += bd.nightMin;
    app.overtimeMinutes += bd.overtimeMin;
    app.base += bd.base;
    app.night += bd.night;
    app.overtime += bd.overtime;
    app.holiday += bd.holiday;
  }

  // 交通費を日数ベースで計算し、合計を更新
  const result: Array<Omit<typeof map extends Map<string, infer V> ? V : never, 'uniqueDates'>> = [];
  for (const [userId, app] of map) {
    app.workDays = app.uniqueDates.size;

    // 交通費 = 出勤日数 × 1日あたりの交通費
    const transportPerDay = orgSettings?.transportAllowanceEnabled
      ? (memberTransport[userId] ?? orgSettings.transportAllowancePerShift ?? 0)
      : 0;
    app.transport = app.workDays * transportPerDay;

    // 合計を再計算
    app.total = Math.round(app.base + app.night + app.overtime + app.holiday + app.transport);

    // uniqueDatesは返さない
    const { uniqueDates, ...userApp } = app;
    result.push(userApp);
  }

  return result.sort((a, b) => a.userName.localeCompare(b.userName));
};