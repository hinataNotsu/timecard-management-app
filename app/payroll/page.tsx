'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDoc, getDocs, orderBy, query, where, Timestamp } from 'firebase/firestore';
import JapaneseHolidays from 'japanese-holidays';
import { db } from '@/lib/firebase';

interface ShiftRow {
  userId: string;
  userName: string;
  date: Date;
  startTime: string;
  endTime: string;
  hourlyWage?: number;
}

interface UserInfo {
  name: string;
  seed?: string;
  bgColor?: string;
}

export default function PayrollPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [userInfoMap, setUserInfoMap] = useState<Record<string, UserInfo>>({});
  const [memberTransport, setMemberTransport] = useState<Record<string, number>>({});
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
          console.warn('[Payroll] failed to load org settings', e);
        }

        // 月範囲で読み込み（statusはクエリせず、アプリ側で承認済みに絞る）
        const y = selectedMonth.getFullYear();
        const m = selectedMonth.getMonth();
        const monthStart = new Date(y, m, 1, 0, 0, 0, 0);
        const nextMonthStart = new Date(y, m + 1, 1, 0, 0, 0, 0);
        const qy = query(
          collection(db, 'shifts'),
          where('organizationId', '==', userProfile.currentOrganizationId),
          where('date', '>=', Timestamp.fromDate(monthStart)),
          where('date', '<', Timestamp.fromDate(nextMonthStart)),
          orderBy('date', 'asc')
        );
        const snap = await getDocs(qy);

        // メンバー個別設定（交通費）を取得
        const memberSettingsSnap = await getDocs(collection(db, 'organizations', userProfile.currentOrganizationId, 'members'));
        const transportMap = new Map<string, number>();
        memberSettingsSnap.forEach((d) => {
          const v = (d.data() as any).transportAllowancePerShift;
          if (typeof v === 'number') transportMap.set(d.id, v);
        });
        setMemberTransport(Object.fromEntries(transportMap));

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
              name = data.displayName || userId;
              seed = data.avatarSeed || name || userId;
              bgColor = data.avatarBackgroundColor;
            }
          } catch {}
            const info: UserInfo = { name, seed, bgColor };
            infoCache.set(userId, info);
            return info;
        };

        const rows: ShiftRow[] = [];
        for (const d of snap.docs) {
          const data = d.data() as any;
          const status = (data.status as string) || 'pending';
          if (status !== 'approved') continue; // 承認済みのみ
          const dateTs: Timestamp = data.date as Timestamp;
          const userRefPath: string = data.userRef?.path || '';
          const userId = userRefPath.split('/').pop();
          if (!userId) continue;
          const { name: userName } = await getUserInfo(userId);
          rows.push({
            userId,
            userName,
            date: dateTs.toDate(),
            startTime: data.startTime,
            endTime: data.endTime,
            hourlyWage: data.hourlyWage != null ? Number(data.hourlyWage) : undefined,
          });
        }
        setShifts(rows);
        // userInfoMapをセット
        setUserInfoMap(Object.fromEntries(Array.from(infoCache.entries()).map(([id, v]) => [id, v])));
      } catch (e) {
        console.error('[Payroll] load error', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userProfile?.currentOrganizationId, selectedMonth]);

  // 計算ヘルパー
  const timeToMin = (t: string) => {
    const [hh, mm] = t.split(':').map(Number);
    return hh * 60 + mm;
  };
  const minutesBetween = (start: string, end: string) => Math.max(0, timeToMin(end) - timeToMin(start));
  const calcNightMinutes = (start: string, end: string, nightStart: string, nightEnd: string) => {
    const s = timeToMin(start);
    const e = timeToMin(end);
    const ns = timeToMin(nightStart);
    const ne = timeToMin(nightEnd);
    const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
    if (ns <= ne) {
      return overlap(s, e, ns, ne);
    } else {
      return overlap(s, e, ns, 1440) + overlap(s, e, 0, ne);
    }
  };
  const calcPay = (row: ShiftRow) => {
    const hourly = row.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
    const totalMin = minutesBetween(row.startTime, row.endTime);
    let base = hourly * (totalMin / 60);
    let premium = 0;
    // 深夜割増
    if (orgSettings?.nightPremiumEnabled) {
      const nightMin = calcNightMinutes(row.startTime, row.endTime, orgSettings.nightStart, orgSettings.nightEnd);
      premium += hourly * (nightMin / 60) * orgSettings.nightPremiumRate;
    }
    // 残業割増（1日閾値超過分に対して）
    if (orgSettings?.overtimePremiumEnabled) {
      const overtimeMin = Math.max(0, totalMin - (orgSettings.overtimeDailyThresholdMinutes ?? 480));
      if (overtimeMin > 0) {
        premium += hourly * (overtimeMin / 60) * (orgSettings.overtimePremiumRate ?? 0.25);
      }
    }
    // 休日割増（全時間に対して）
    if (orgSettings?.holidayPremiumEnabled) {
      const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
      const isHoliday = (d: Date) => !!JapaneseHolidays.isHoliday(d);
      const day = row.date;
      const holiday = (orgSettings.holidayIncludesWeekend && isWeekend(day)) || isHoliday(day);
      if (holiday) {
        premium += hourly * (totalMin / 60) * (orgSettings.holidayPremiumRate ?? 0.35);
      }
    }
    // 交通費（ユーザー個別があれば優先、なければ組織デフォルト、無効なら0）
    const transport = orgSettings?.transportAllowanceEnabled
      ? (memberTransport[row.userId] ?? orgSettings.transportAllowancePerShift ?? 0)
      : 0;
    return Math.round(base + premium + transport);
  };

  // 明細内訳
  const calcBreakdown = (row: ShiftRow) => {
    const hourly = row.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
    const totalMin = minutesBetween(row.startTime, row.endTime);
    const totalH = totalMin / 60;
    const base = hourly * totalH;

    const nightMin = orgSettings?.nightPremiumEnabled
      ? calcNightMinutes(row.startTime, row.endTime, orgSettings.nightStart, orgSettings.nightEnd)
      : 0;
    const nightH = nightMin / 60;
    const night = orgSettings?.nightPremiumEnabled ? hourly * nightH * (orgSettings.nightPremiumRate ?? 0) : 0;

    const overtimeMin = orgSettings?.overtimePremiumEnabled
      ? Math.max(0, totalMin - (orgSettings.overtimeDailyThresholdMinutes ?? 480))
      : 0;
    const overtimeH = overtimeMin / 60;
    const overtime = orgSettings?.overtimePremiumEnabled ? hourly * overtimeH * (orgSettings.overtimePremiumRate ?? 0) : 0;

    const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
    const isHoliday = (d: Date) => !!JapaneseHolidays.isHoliday(d);
    const isHol = !!orgSettings?.holidayPremiumEnabled && (
      (orgSettings?.holidayIncludesWeekend && isWeekend(row.date)) || isHoliday(row.date)
    );
    const holiday = isHol ? hourly * totalH * (orgSettings?.holidayPremiumRate ?? 0) : 0;

    const transport = orgSettings?.transportAllowanceEnabled
      ? (memberTransport[row.userId] ?? orgSettings.transportAllowancePerShift ?? 0)
      : 0;

    const total = Math.round(base + night + overtime + holiday + transport);
    return { base, night, overtime, holiday, transport, total, totalMin, nightMin };
  };

  // サマリー
  const summary = useMemo(() => {
    const totalShifts = shifts.length;
    let totalMin = 0;
    let nightMin = 0;
    let totalPay = 0;
    for (const s of shifts) {
      const m = minutesBetween(s.startTime, s.endTime);
      totalMin += m;
      nightMin += orgSettings ? calcNightMinutes(s.startTime, s.endTime, orgSettings.nightStart, orgSettings.nightEnd) : 0;
      totalPay += calcPay(s);
    }
    return { totalShifts, totalMin, nightMin, totalPay };
  }, [shifts, orgSettings, memberTransport]);

  // ユーザー別集計
  const byUser = useMemo(() => {
    const map = new Map<string, { userId: string; userName: string; count: number; min: number; night: number; base: number; nightAmount: number; overtimeAmount: number; holidayAmount: number; transportAmount: number; total: number }>();
    for (const s of shifts) {
      const key = s.userId;
      const cur = map.get(key) || { userId: s.userId, userName: s.userName, count: 0, min: 0, night: 0, base: 0, nightAmount: 0, overtimeAmount: 0, holidayAmount: 0, transportAmount: 0, total: 0 };
      const m = minutesBetween(s.startTime, s.endTime);
      const n = orgSettings ? calcNightMinutes(s.startTime, s.endTime, orgSettings.nightStart, orgSettings.nightEnd) : 0;
      cur.count += 1;
      cur.min += m;
      cur.night += n;
      const bd = calcBreakdown(s);
      cur.base += bd.base;
      cur.nightAmount += bd.night;
      cur.overtimeAmount += bd.overtime;
      cur.holidayAmount += bd.holiday;
      cur.transportAmount += bd.transport;
      cur.total += bd.total;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.userName.localeCompare(b.userName));
  }, [shifts, orgSettings, memberTransport]);

  // CSV出力
  const exportDetailCsv = () => {
    const header = ['日付','ユーザー','開始','終了','時間(分)','夜間(分)','時給','基本(円)','深夜(円)','残業(円)','休日(円)','交通費(円)','合計(円)'];
    const lines = [header.join(',')];
    shifts.forEach(s => {
      const hourly = s.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
      const bd = calcBreakdown(s);
      lines.push([
        `${s.date.getFullYear()}-${String(s.date.getMonth()+1).padStart(2,'0')}-${String(s.date.getDate()).padStart(2,'0')}`,
        s.userName,
        s.startTime,
        s.endTime,
        String(bd.totalMin),
        String(bd.nightMin),
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
    a.download = `payroll_detail_${y}-${String(m).padStart(2,'0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportUserCsv = () => {
    const header = ['ユーザー','件数','時間(分)','夜間(分)','基本(円)','深夜(円)','残業(円)','休日(円)','交通費(円)','合計(円)'];
    const lines = [header.join(',')];
    byUser.forEach(row => {
      lines.push([
        row.userName,
        String(row.count),
        String(row.min),
        String(row.night),
        String(Math.round(row.base)),
        String(Math.round(row.nightAmount)),
        String(Math.round(row.overtimeAmount)),
        String(Math.round(row.holidayAmount)),
        String(Math.round(row.transportAmount)),
        String(Math.round(row.total)),
      ].join(','));
    });
    const csv = '\ufeff' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const y = selectedMonth.getFullYear();
    const m = selectedMonth.getMonth() + 1;
    a.download = `payroll_users_${y}-${String(m).padStart(2,'0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">給与計算</h1>
          <button onClick={() => router.push('/dashboard/company')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        {/* 交通費無効の警告 */}
        {!orgSettings?.transportAllowanceEnabled && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <p className="font-semibold text-yellow-800">交通費が無効になっています</p>
                <p className="text-sm text-yellow-700 mt-1">
                  交通費を給与計算に反映するには、
                  <button 
                    onClick={() => router.push('/organization/settings')}
                    className="underline hover:text-yellow-900 font-medium"
                  >
                    企業情報設定
                  </button>
                  で「交通費手当」を有効にしてください。
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="px-2 py-1 border rounded">←</button>
            <div className="font-semibold">{selectedMonth.getFullYear()}年 {selectedMonth.getMonth() + 1}月</div>
            <button onClick={nextMonth} className="px-2 py-1 border rounded">→</button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportUserCsv} className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700">ユーザー別CSV</button>
            <button onClick={exportDetailCsv} className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700">明細CSV</button>
          </div>
        </div>

        {/* サマリーカード */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">承認済みシフト件数</p>
            <p className="text-2xl font-bold text-gray-900">{summary.totalShifts}件</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">総労働時間</p>
            <p className="text-2xl font-bold text-gray-900">{(summary.totalMin / 60).toFixed(1)}時間</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">夜間時間</p>
            <p className="text-2xl font-bold text-gray-900">{(summary.nightMin / 60).toFixed(1)}時間</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">合計支給額</p>
            <p className="text-2xl font-bold text-gray-900">¥{summary.totalPay.toLocaleString('ja-JP')}</p>
          </div>
        </div>

        {/* ユーザー別集計テーブル */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 border-b text-left">ユーザー</th>
                <th className="p-2 border-b text-center">件数</th>
                <th className="p-2 border-b text-center">時間(分)</th>
                <th className="p-2 border-b text-center">夜間(分)</th>
                <th className="p-2 border-b text-center">基本(円)</th>
                <th className="p-2 border-b text-center">深夜(円)</th>
                <th className="p-2 border-b text-center">残業(円)</th>
                <th className="p-2 border-b text-center">休日(円)</th>
                <th className="p-2 border-b text-center">交通費(円)</th>
                <th className="p-2 border-b text-center">合計(円)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-center" colSpan={10}>読み込み中...</td></tr>
              ) : byUser.length === 0 ? (
                <tr><td className="p-4 text-center" colSpan={10}>該当データがありません</td></tr>
              ) : (
                byUser.map((u) => {
                  const info = userInfoMap[u.userId];
                  const seed = info?.seed || u.userName || u.userId;
                  const bgColor = info?.bgColor;
                  const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}${bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear'}&radius=50&fontWeight=700`;
                  return (
                    <tr key={u.userId} className="hover:bg-gray-50">
                      <td className="p-2 border-b text-left">
                        <div className="flex items-center gap-2">
                          <img src={avatarUrl} alt={u.userName} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                          <span>{u.userName}</span>
                        </div>
                      </td>
                      <td className="p-2 border-b text-center">{u.count}</td>
                      <td className="p-2 border-b text-center">{u.min}</td>
                      <td className="p-2 border-b text-center">{u.night}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(u.base).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(u.nightAmount).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(u.overtimeAmount).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(u.holidayAmount).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(u.transportAmount).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(u.total).toLocaleString('ja-JP')}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {!loading && byUser.length > 0 && (
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="p-2 border-t text-left">合計</td>
                  <td className="p-2 border-t text-center">{byUser.reduce((a,c)=>a+c.count,0)}</td>
                  <td className="p-2 border-t text-center">{byUser.reduce((a,c)=>a+c.min,0)}</td>
                  <td className="p-2 border-t text-center">{byUser.reduce((a,c)=>a+c.night,0)}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(byUser.reduce((a,c)=>a+c.base,0)).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(byUser.reduce((a,c)=>a+c.nightAmount,0)).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(byUser.reduce((a,c)=>a+c.overtimeAmount,0)).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(byUser.reduce((a,c)=>a+c.holidayAmount,0)).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(byUser.reduce((a,c)=>a+c.transportAmount,0)).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(byUser.reduce((a,c)=>a+c.total,0)).toLocaleString('ja-JP')}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
