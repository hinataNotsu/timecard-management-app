'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { collection, doc, getDoc, getDocs, orderBy, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import JapaneseHolidays from 'japanese-holidays';

interface ShiftRow {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  hourlyWage?: number;
}

export default function PartTimePayrollPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
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
  const [transportPerShift, setTransportPerShift] = useState<number>(0);

  // アクセス制御: アルバイトのみ
  useEffect(() => {
    if (!userProfile) return;
    if (userProfile.isManage) {
      router.push('/dashboard/company');
      return;
    }
  }, [userProfile, router]);

  useEffect(() => {
    const load = async () => {
      if (!userProfile?.currentOrganizationId || !userProfile.uid) return;
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
          console.warn('[PartTimePayroll] org settings load failed', e);
        }

        // 個別交通費設定
        try {
          const memberSnap = await getDoc(doc(db, 'organizations', userProfile.currentOrganizationId, 'members', userProfile.uid));
          if (memberSnap.exists()) {
            const mv = memberSnap.data() as any;
            if (typeof mv.transportAllowancePerShift === 'number') {
              setTransportPerShift(mv.transportAllowancePerShift);
            }
          }
        } catch (e) {
          console.warn('[PartTimePayroll] member setting load failed', e);
        }

        // 月内シフト取得 (自分のみ)
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
        const rows: ShiftRow[] = [];
        for (const d of snap.docs) {
          const data = d.data() as any;
          const status = (data.status as string) || 'pending';
          if (status !== 'approved') continue;
          const userRefPath: string = data.userRef?.path || '';
          const userId = userRefPath.split('/').pop();
          if (userId !== userProfile.uid) continue; // 自分のみ
          const dateTs: Timestamp = data.date as Timestamp;
          rows.push({
            id: d.id,
            date: dateTs.toDate(),
            startTime: data.startTime,
            endTime: data.endTime,
            hourlyWage: data.hourlyWage != null ? Number(data.hourlyWage) : undefined,
          });
        }
        setShifts(rows);
      } catch (e) {
        console.error('[PartTimePayroll] load error', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userProfile?.currentOrganizationId, userProfile?.uid, selectedMonth]);

  // 計算ヘルパー
  const timeToMin = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; };
  const minutesBetween = (start: string, end: string) => Math.max(0, timeToMin(end) - timeToMin(start));
  const calcNightMinutes = (start: string, end: string, nightStart: string, nightEnd: string) => {
    const s = timeToMin(start); const e = timeToMin(end); const ns = timeToMin(nightStart); const ne = timeToMin(nightEnd);
    const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, a1 > b1 ? a1 : b1));
    if (ns <= ne) return Math.max(0, Math.min(e, ne) - Math.max(s, ns));
    return Math.max(0, Math.min(e, 1440) - Math.max(s, ns)) + Math.max(0, Math.min(e, ne) - Math.max(s, 0));
  };

  const calcBreakdown = (row: ShiftRow) => {
    const hourly = row.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
    const totalMin = minutesBetween(row.startTime, row.endTime);
    const totalH = totalMin / 60;
    const base = hourly * totalH;
    const nightMin = orgSettings?.nightPremiumEnabled ? calcNightMinutes(row.startTime, row.endTime, orgSettings.nightStart, orgSettings.nightEnd) : 0;
    const night = orgSettings?.nightPremiumEnabled ? hourly * (nightMin / 60) * (orgSettings.nightPremiumRate ?? 0) : 0;
    const overtimeMin = orgSettings?.overtimePremiumEnabled ? Math.max(0, totalMin - (orgSettings.overtimeDailyThresholdMinutes ?? 480)) : 0;
    const overtime = orgSettings?.overtimePremiumEnabled ? hourly * (overtimeMin / 60) * (orgSettings.overtimePremiumRate ?? 0) : 0;
    const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
    const isHoliday = (d: Date) => !!JapaneseHolidays.isHoliday(d);
    const isHol = !!orgSettings?.holidayPremiumEnabled && ((orgSettings?.holidayIncludesWeekend && isWeekend(row.date)) || isHoliday(row.date));
    const holiday = isHol ? hourly * totalH * (orgSettings?.holidayPremiumRate ?? 0) : 0;
    const transport = orgSettings?.transportAllowanceEnabled ? (transportPerShift || orgSettings.transportAllowancePerShift || 0) : 0;
    const total = Math.round(base + night + overtime + holiday + transport);
    return { base, night, overtime, holiday, transport, total, totalMin, nightMin, overtimeMin };
  };

  const summary = useMemo(() => {
    let count = 0, totalMin = 0, nightMin = 0, overtimeMin = 0;
    let base = 0, night = 0, overtime = 0, holiday = 0, transport = 0, total = 0;
    for (const s of shifts) {
      count++;
      const bd = calcBreakdown(s);
      totalMin += bd.totalMin; nightMin += bd.nightMin; overtimeMin += bd.overtimeMin;
      base += bd.base; night += bd.night; overtime += bd.overtime; holiday += bd.holiday; transport += bd.transport; total += bd.total;
    }
    return { count, totalMin, nightMin, overtimeMin, base, night, overtime, holiday, transport, total };
  }, [shifts, orgSettings, transportPerShift]);

  const exportCsv = () => {
    const header = ['日付','開始','終了','時間(分)','夜間(分)','残業(分)','時給','基本(円)','深夜(円)','残業(円)','休日(円)','交通費(円)','合計(円)'];
    const lines = [header.join(',')];
    shifts.forEach(s => {
      const bd = calcBreakdown(s);
      const hourly = s.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
      lines.push([
        `${s.date.getFullYear()}-${String(s.date.getMonth()+1).padStart(2,'0')}-${String(s.date.getDate()).padStart(2,'0')}`,
        s.startTime,
        s.endTime,
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
    a.download = `my_payroll_${y}-${String(m).padStart(2,'0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()-1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()+1, 1));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">今月の給与一覧</h1>
          <button onClick={() => router.push('/dashboard/part-time')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="px-2 py-1 border rounded">←</button>
            <div className="font-semibold">{selectedMonth.getFullYear()}年 {selectedMonth.getMonth()+1}月</div>
            <button onClick={nextMonth} className="px-2 py-1 border rounded">→</button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportCsv} className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700">CSV出力</button>
          </div>
        </div>

        {/* サマリーカード */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">承認済みシフト件数</p>
            <p className="text-2xl font-bold text-gray-900">{summary.count}件</p>
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

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 border-b text-center">日付</th>
                <th className="p-2 border-b text-center">開始</th>
                <th className="p-2 border-b text-center">終了</th>
                <th className="p-2 border-b text-center">時間(分)</th>
                <th className="p-2 border-b text-center">夜間(分)</th>
                <th className="p-2 border-b text-center">残業(分)</th>
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
                <tr><td className="p-4 text-center" colSpan={12}>読み込み中...</td></tr>
              ) : shifts.length === 0 ? (
                <tr><td className="p-4 text-center" colSpan={12}>承認済みシフトがありません</td></tr>
              ) : (
                shifts.map(s => {
                  const bd = calcBreakdown(s);
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="p-2 border-b text-center">{s.date.getFullYear()}-{String(s.date.getMonth()+1).padStart(2,'0')}-{String(s.date.getDate()).padStart(2,'0')}</td>
                      <td className="p-2 border-b text-center">{s.startTime}</td>
                      <td className="p-2 border-b text-center">{s.endTime}</td>
                      <td className="p-2 border-b text-center">{bd.totalMin}</td>
                      <td className="p-2 border-b text-center">{bd.nightMin}</td>
                      <td className="p-2 border-b text-center">{bd.overtimeMin}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(bd.base).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(bd.night).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(bd.overtime).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(bd.holiday).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(bd.transport).toLocaleString('ja-JP')}</td>
                      <td className="p-2 border-b text-center">¥{Math.round(bd.total).toLocaleString('ja-JP')}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {!loading && shifts.length > 0 && (
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="p-2 border-t text-center">合計</td>
                  <td className="p-2 border-t text-center" colSpan={2}></td>
                  <td className="p-2 border-t text-center">{summary.totalMin}</td>
                  <td className="p-2 border-t text-center">{summary.nightMin}</td>
                  <td className="p-2 border-t text-center">{summary.overtimeMin}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(summary.base).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(summary.night).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(summary.overtime).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(summary.holiday).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(summary.transport).toLocaleString('ja-JP')}</td>
                  <td className="p-2 border-t text-center">¥{Math.round(summary.total).toLocaleString('ja-JP')}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
