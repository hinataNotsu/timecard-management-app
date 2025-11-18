'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, getDocs, doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import JapaneseHolidays from 'japanese-holidays';

interface TimecardRow {
  id: string;
  userId: string;
  dateKey: string;
  date: Date;
  clockInAt?: Timestamp;
  breakStartAt?: Timestamp;
  breakEndAt?: Timestamp;
  clockOutAt?: Timestamp;
  hourlyWage?: number;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
}

interface UserInfo {
  name: string;
  seed?: string;
  bgColor?: string;
}

interface UserReport {
  userId: string;
  userName: string;
  avatarUrl: string;
  workDays: number;
  totalMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  base: number;
  night: number;
  overtime: number;
  holiday: number;
  transport: number;
  total: number;
}

export default function ReportPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timecards, setTimecards] = useState<TimecardRow[]>([]);
  const [userInfoMap, setUserInfoMap] = useState<Record<string, UserInfo>>({});
  const [memberTransport, setMemberTransport] = useState<Record<string, number>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [orgSettings, setOrgSettings] = useState<{
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
  } | null>(null);

  useEffect(() => {
    if (!userProfile) return;
    if (!userProfile.isManage) {
      router.push('/dashboard/part-time');
      return;
    }
  }, [userProfile, router]);

  useEffect(() => {
    const load = async () => {
      if (!userProfile?.currentOrganizationId) return;
      setLoading(true);
      try {
        // 組織設定
        try {
          const orgSnap = await getDoc(doc(db, 'organizations', userProfile.currentOrganizationId));
          if (orgSnap.exists()) {
            const o = orgSnap.data() as any;
            setOrgSettings({
              defaultHourlyWage: Number(o.defaultHourlyWage ?? 1100),
              nightPremiumEnabled: !!o.nightPremiumEnabled,
              nightPremiumRate: Number(o.nightPremiumRate ?? 0.25),
              nightStart: o.nightStart ?? '22:00',
              nightEnd: o.nightEnd ?? '05:00',
              overtimePremiumEnabled: !!o.overtimePremiumEnabled,
              overtimePremiumRate: Number(o.overtimePremiumRate ?? 0.25),
              overtimeDailyThresholdMinutes: Number(o.overtimeDailyThresholdMinutes ?? 480),
              holidayPremiumEnabled: !!o.holidayPremiumEnabled,
              holidayPremiumRate: Number(o.holidayPremiumRate ?? 0.35),
              holidayIncludesWeekend: o.holidayIncludesWeekend ?? true,
              transportAllowanceEnabled: !!o.transportAllowanceEnabled,
              transportAllowancePerShift: Number(o.transportAllowancePerShift ?? 0),
            });
          }
        } catch (e) {
          console.warn('[Report] failed to load org settings', e);
        }

        // メンバー個別設定（交通費）を取得
        try {
          const memberSettingsSnap = await getDocs(collection(db, 'organizations', userProfile.currentOrganizationId, 'members'));
          const transportMap = new Map<string, number>();
          memberSettingsSnap.forEach((d) => {
            const v = (d.data() as any).transportAllowancePerShift;
            if (typeof v === 'number') transportMap.set(d.id, v);
          });
          setMemberTransport(Object.fromEntries(transportMap));
        } catch (e) {
          console.warn('[Report] member setting load failed', e);
        }

        // 月範囲のタイムカードを取得（status=approvedのみ）
        const y = selectedMonth.getFullYear();
        const m = selectedMonth.getMonth();
        const startKey = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        const endY = m === 11 ? y + 1 : y;
        const endM = m === 11 ? 0 : m + 1;
        const endKey = `${endY}-${String(endM + 1).padStart(2, '0')}-01`;

        const qy = query(
          collection(db, 'timecards'),
          where('organizationId', '==', userProfile.currentOrganizationId),
          where('dateKey', '>=', startKey),
          where('dateKey', '<', endKey)
        );
        const snap = await getDocs(qy);

        const infoCache = new Map<string, UserInfo>();
        const getUserInfo = async (userId: string) => {
          if (infoCache.has(userId)) return infoCache.get(userId)!;
          let name = userId;
          let seed: string | undefined;
          let bgColor: string | undefined;
          try {
            const u = await getDoc(doc(db, 'users', userId));
            if (u.exists()) {
              const data = u.data() as any;
              if (data.deleted) {
                name = `(退職済み) ${data.displayName || userId}`;
              } else {
                name = data.displayName || userId;
              }
              seed = data.avatarSeed || name || userId;
              bgColor = data.avatarBackgroundColor;
            }
          } catch {
            name = `(退職済み) ${userId}`;
          }
          const info: UserInfo = { name, seed, bgColor };
          infoCache.set(userId, info);
          return info;
        };

        const rows: TimecardRow[] = [];
        for (const d of snap.docs) {
          const data = d.data() as any;
          // approved（承認済み）のみを表示
          if (data.status !== 'approved') continue;
          
          await getUserInfo(data.userId);
          
          const [year, month, day] = data.dateKey.split('-').map(Number);
          rows.push({
            id: d.id,
            userId: data.userId,
            dateKey: data.dateKey,
            date: new Date(year, month - 1, day),
            clockInAt: data.clockInAt,
            breakStartAt: data.breakStartAt,
            breakEndAt: data.breakEndAt,
            clockOutAt: data.clockOutAt,
            hourlyWage: data.hourlyWage,
            status: data.status || 'approved',
          });
        }
        setTimecards(rows);
        setUserInfoMap(Object.fromEntries(Array.from(infoCache.entries()).map(([id, v]) => [id, v])));
        setError(null);
      } catch (e: any) {
        console.error('[Report] load error', e);
        if (e?.code === 'failed-precondition' || e?.message?.includes('index')) {
          setError('データベースのインデックスを構築中です。数分後に再度お試しください。');
        } else {
          setError('データの読み込みに失敗しました。');
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userProfile?.currentOrganizationId, selectedMonth]);

  // 計算ヘルパー
  const minutesBetweenTimestamps = (start?: Timestamp, end?: Timestamp) => {
    if (!start || !end) return 0;
    return Math.max(0, Math.round((end.toMillis() - start.toMillis()) / 60000));
  };
  
  const calcNightMinutes = (clockIn?: Timestamp, clockOut?: Timestamp, nightStart?: string, nightEnd?: string) => {
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

  const calcBreakdown = (row: TimecardRow) => {
    const hourly = row.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
    const grossMin = minutesBetweenTimestamps(row.clockInAt, row.clockOutAt);
    const breakMin = minutesBetweenTimestamps(row.breakStartAt, row.breakEndAt);
    const totalMin = Math.max(0, grossMin - breakMin);
    const totalH = totalMin / 60;
    const base = hourly * totalH;
    const nightMin = orgSettings?.nightPremiumEnabled ? calcNightMinutes(row.clockInAt, row.clockOutAt, orgSettings.nightStart, orgSettings.nightEnd) : 0;
    const night = orgSettings?.nightPremiumEnabled ? hourly * (nightMin / 60) * (orgSettings.nightPremiumRate ?? 0) : 0;
    const overtimeMin = orgSettings?.overtimePremiumEnabled ? Math.max(0, totalMin - (orgSettings.overtimeDailyThresholdMinutes ?? 480)) : 0;
    const overtime = orgSettings?.overtimePremiumEnabled ? hourly * (overtimeMin / 60) * (orgSettings.overtimePremiumRate ?? 0) : 0;
    const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
    const isHoliday = (d: Date) => !!JapaneseHolidays.isHoliday(d);
    const isHol = !!orgSettings?.holidayPremiumEnabled && ((orgSettings?.holidayIncludesWeekend && isWeekend(row.date)) || isHoliday(row.date));
    const holiday = isHol ? hourly * totalH * (orgSettings?.holidayPremiumRate ?? 0) : 0;
    const transport = orgSettings?.transportAllowanceEnabled ? (memberTransport[row.userId] ?? orgSettings.transportAllowancePerShift ?? 0) : 0;
    const total = Math.round(base + night + overtime + holiday + transport);
    return { base, night, overtime, holiday, transport, total, totalMin, nightMin, overtimeMin, breakMin };
  };

  // ユーザー別集計
  const userReports = useMemo(() => {
    const map = new Map<string, UserReport>();
    
    for (const tc of timecards) {
      if (!map.has(tc.userId)) {
        const info = userInfoMap[tc.userId] || { name: tc.userId };
        const seed = info.seed || info.name || tc.userId;
        const bgColor = info.bgColor;
        const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}${bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear'}&radius=50&fontWeight=700`;
        
        map.set(tc.userId, {
          userId: tc.userId,
          userName: info.name,
          avatarUrl,
          workDays: 0,
          totalMinutes: 0,
          nightMinutes: 0,
          overtimeMinutes: 0,
          base: 0,
          night: 0,
          overtime: 0,
          holiday: 0,
          transport: 0,
          total: 0,
        });
      }
      
      const report = map.get(tc.userId)!;
      const uniqueDays = new Set(timecards.filter(t => t.userId === tc.userId).map(t => t.dateKey));
      report.workDays = uniqueDays.size;
      
      const bd = calcBreakdown(tc);
      report.totalMinutes += bd.totalMin;
      report.nightMinutes += bd.nightMin;
      report.overtimeMinutes += bd.overtimeMin;
      report.base += bd.base;
      report.night += bd.night;
      report.overtime += bd.overtime;
      report.holiday += bd.holiday;
      report.transport += bd.transport;
      report.total += bd.total;
    }
    
    return Array.from(map.values()).sort((a, b) => a.userName.localeCompare(b.userName));
  }, [timecards, orgSettings, memberTransport, userInfoMap]);

  const summary = useMemo(() => {
    let totalStaff = userReports.length;
    let totalDays = 0;
    let totalMin = 0;
    let nightMin = 0;
    let overtimeMin = 0;
    let base = 0, night = 0, overtime = 0, holiday = 0, transport = 0, total = 0;
    
    for (const r of userReports) {
      totalDays += r.workDays;
      totalMin += r.totalMinutes;
      nightMin += r.nightMinutes;
      overtimeMin += r.overtimeMinutes;
      base += r.base;
      night += r.night;
      overtime += r.overtime;
      holiday += r.holiday;
      transport += r.transport;
      total += r.total;
    }
    
    return { totalStaff, totalDays, totalMin, nightMin, overtimeMin, base, night, overtime, holiday, transport, total };
  }, [userReports]);

  const exportCsv = () => {
    const header = ['氏名','出勤日数','総労働時間(分)','深夜時間(分)','残業時間(分)','基本給(円)','深夜手当(円)','残業手当(円)','休日手当(円)','交通費(円)','総支給額(円)'];
    const lines = [header.join(',')];
    userReports.forEach(r => {
      lines.push([
        r.userName,
        String(r.workDays),
        String(r.totalMinutes),
        String(r.nightMinutes),
        String(r.overtimeMinutes),
        String(Math.round(r.base)),
        String(Math.round(r.night)),
        String(Math.round(r.overtime)),
        String(Math.round(r.holiday)),
        String(Math.round(r.transport)),
        String(Math.round(r.total)),
      ].join(','));
    });
    const csv = '\ufeff' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const y = selectedMonth.getFullYear();
    const m = selectedMonth.getMonth() + 1;
    a.download = `payroll_report_${y}-${String(m).padStart(2,'0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()-1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()+1, 1));

  const selectedUser = selectedUserId ? userReports.find(r => r.userId === selectedUserId) : null;
  const selectedTimecards = selectedUserId ? timecards.filter(tc => tc.userId === selectedUserId) : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">給与レポート（確定済み）</h1>
          <button onClick={() => router.push('/dashboard/company')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        {error && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <p className="font-semibold text-yellow-800">{error}</p>
                <button onClick={() => window.location.reload()} className="mt-2 px-3 py-1 text-sm rounded bg-yellow-600 text-white hover:bg-yellow-700">再読み込み</button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="px-2 py-1 border rounded">←</button>
            <div className="font-semibold">{selectedMonth.getFullYear()}年 {selectedMonth.getMonth()+1}月</div>
            <button onClick={nextMonth} className="px-2 py-1 border rounded">→</button>
          </div>
          <div className="ml-auto">
            <button onClick={exportCsv} className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700">CSV出力</button>
          </div>
        </div>

        {/* サマリーカード */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">スタッフ数</p>
            <p className="text-2xl font-bold text-gray-900">{summary.totalStaff}名</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">総出勤日数</p>
            <p className="text-2xl font-bold text-gray-900">{summary.totalDays}日</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">総労働時間</p>
            <p className="text-2xl font-bold text-gray-900">{(summary.totalMin/60).toFixed(1)}時間</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">深夜時間</p>
            <p className="text-2xl font-bold text-gray-900">{(summary.nightMin/60).toFixed(1)}時間</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">交通費合計</p>
            <p className="text-2xl font-bold text-gray-900">¥{Math.round(summary.transport).toLocaleString('ja-JP')}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">総支給額</p>
            <p className="text-2xl font-bold text-gray-900">¥{Math.round(summary.total).toLocaleString('ja-JP')}</p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">読み込み中...</p>
          </div>
        ) : selectedUser ? (
          // 詳細表示
          <div>
            <div className="mb-4">
              <button onClick={() => setSelectedUserId(null)} className="text-sm text-blue-600 hover:text-blue-800">← 一覧に戻る</button>
            </div>
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <div className="flex items-center gap-4 mb-4">
                <img src={selectedUser.avatarUrl} alt={selectedUser.userName} className="w-16 h-16 rounded-full" />
                <div>
                  <h2 className="text-xl font-bold">{selectedUser.userName}</h2>
                  <p className="text-sm text-gray-600">出勤日数: {selectedUser.workDays}日 / 総労働時間: {(selectedUser.totalMinutes/60).toFixed(1)}時間</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-xs text-gray-600">基本給</p>
                  <p className="text-lg font-semibold">¥{Math.round(selectedUser.base).toLocaleString('ja-JP')}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">深夜手当</p>
                  <p className="text-lg font-semibold">¥{Math.round(selectedUser.night).toLocaleString('ja-JP')}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">残業手当</p>
                  <p className="text-lg font-semibold">¥{Math.round(selectedUser.overtime).toLocaleString('ja-JP')}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">休日手当</p>
                  <p className="text-lg font-semibold">¥{Math.round(selectedUser.holiday).toLocaleString('ja-JP')}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600">交通費</p>
                  <p className="text-lg font-semibold">¥{Math.round(selectedUser.transport).toLocaleString('ja-JP')}</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm text-gray-600">総支給額</p>
                <p className="text-3xl font-bold text-blue-600">¥{Math.round(selectedUser.total).toLocaleString('ja-JP')}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 border-b text-center">日付</th>
                    <th className="p-2 border-b text-center">出勤</th>
                    <th className="p-2 border-b text-center">退勤</th>
                    <th className="p-2 border-b text-center">休憩(分)</th>
                    <th className="p-2 border-b text-center">労働(分)</th>
                    <th className="p-2 border-b text-center">深夜(分)</th>
                    <th className="p-2 border-b text-center">残業(分)</th>
                    <th className="p-2 border-b text-center">給与(円)</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTimecards.length === 0 ? (
                    <tr><td className="p-4 text-center" colSpan={8}>データがありません</td></tr>
                  ) : (
                    selectedTimecards.map(tc => {
                      const bd = calcBreakdown(tc);
                      const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}) : '--:--';
                      return (
                        <tr key={tc.id} className="hover:bg-gray-50">
                          <td className="p-2 border-b text-center">{tc.dateKey}</td>
                          <td className="p-2 border-b text-center">{fmt(tc.clockInAt)}</td>
                          <td className="p-2 border-b text-center">{fmt(tc.clockOutAt)}</td>
                          <td className="p-2 border-b text-center">{bd.breakMin}</td>
                          <td className="p-2 border-b text-center">{bd.totalMin}</td>
                          <td className="p-2 border-b text-center">{bd.nightMin}</td>
                          <td className="p-2 border-b text-center">{bd.overtimeMin}</td>
                          <td className="p-2 border-b text-center">¥{bd.total.toLocaleString('ja-JP')}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          // 一覧表示
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 border-b text-left">氏名</th>
                  <th className="p-3 border-b text-center">出勤日数</th>
                  <th className="p-3 border-b text-center">労働時間</th>
                  <th className="p-3 border-b text-center">深夜時間</th>
                  <th className="p-3 border-b text-center">残業時間</th>
                  <th className="p-3 border-b text-center">基本給</th>
                  <th className="p-3 border-b text-center">深夜</th>
                  <th className="p-3 border-b text-center">残業</th>
                  <th className="p-3 border-b text-center">休日</th>
                  <th className="p-3 border-b text-center">交通費</th>
                  <th className="p-3 border-b text-center">総支給額</th>
                  <th className="p-3 border-b text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {userReports.length === 0 ? (
                  <tr><td className="p-8 text-center text-gray-500" colSpan={12}>該当月の承認済みタイムカードがありません</td></tr>
                ) : (
                  userReports.map(r => (
                    <tr key={r.userId} className="hover:bg-gray-50">
                      <td className="p-3 border-b">
                        <div className="flex items-center gap-2">
                          <img src={r.avatarUrl} alt={r.userName} className="w-8 h-8 rounded-full" />
                          <span className="font-medium">{r.userName}</span>
                        </div>
                      </td>
                      <td className="p-3 border-b text-center">{r.workDays}日</td>
                      <td className="p-3 border-b text-center">{(r.totalMinutes/60).toFixed(1)}h</td>
                      <td className="p-3 border-b text-center">{(r.nightMinutes/60).toFixed(1)}h</td>
                      <td className="p-3 border-b text-center">{(r.overtimeMinutes/60).toFixed(1)}h</td>
                      <td className="p-3 border-b text-center">¥{Math.round(r.base).toLocaleString('ja-JP')}</td>
                      <td className="p-3 border-b text-center">¥{Math.round(r.night).toLocaleString('ja-JP')}</td>
                      <td className="p-3 border-b text-center">¥{Math.round(r.overtime).toLocaleString('ja-JP')}</td>
                      <td className="p-3 border-b text-center">¥{Math.round(r.holiday).toLocaleString('ja-JP')}</td>
                      <td className="p-3 border-b text-center">¥{Math.round(r.transport).toLocaleString('ja-JP')}</td>
                      <td className="p-3 border-b text-center font-semibold text-blue-600">¥{Math.round(r.total).toLocaleString('ja-JP')}</td>
                      <td className="p-3 border-b text-center">
                        <button onClick={() => setSelectedUserId(r.userId)} className="px-3 py-1 text-xs rounded bg-gray-600 text-white hover:bg-gray-700">詳細</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-sm text-gray-600 space-y-1">
          <p>※ 承認済み（status=approved）のタイムカードのみを集計しています</p>
          <p>※ 詳細ボタンで個別の勤怠履歴を確認できます</p>
        </div>
      </div>
    </div>
  );
}
