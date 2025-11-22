'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { collection, doc, getDoc, getDocs, orderBy, query, where, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import JapaneseHolidays from 'japanese-holidays';

interface TimecardRow {
  id: string;
  dateKey: string;
  date: Date;
  clockInAt?: Timestamp;
  breakStartAt?: Timestamp;
  breakEndAt?: Timestamp;
  clockOutAt?: Timestamp;
  hourlyWage?: number;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
}

export default function PartTimePayrollPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timecards, setTimecards] = useState<TimecardRow[]>([]);
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

        // 月内タイムカード取得 (自分のみ、承認済みのみ)
        const y = selectedMonth.getFullYear();
        const m = selectedMonth.getMonth();
        const startKey = `${y}-${String(m+1).padStart(2,'0')}-01`;
        const endKey = `${m === 11 ? y+1 : y}-${String(m === 11 ? 1 : m+2).padStart(2,'0')}-01`;
        const qy = query(
          collection(db, 'timecards'),
          where('organizationId', '==', userProfile.currentOrganizationId),
          where('userId', '==', userProfile.uid),
          where('dateKey', '>=', startKey),
          where('dateKey', '<', endKey)
        );
        const snap = await getDocs(qy);
        const rows: TimecardRow[] = [];
        for (const d of snap.docs) {
          const data = d.data() as any;
          // 全てのステータスを表示（draft, pending, approved, rejected）
          // 古いデータでstatusがない場合は'approved'とみなす
          const [dy, dm, dd] = data.dateKey.split('-').map(Number);
          rows.push({
            id: d.id,
            dateKey: data.dateKey,
            date: new Date(dy, dm-1, dd),
            clockInAt: data.clockInAt,
            breakStartAt: data.breakStartAt,
            breakEndAt: data.breakEndAt,
            clockOutAt: data.clockOutAt,
            hourlyWage: data.hourlyWage,
            status: data.status || 'approved',
          });
        }
        rows.sort((a,b) => a.date.getTime() - b.date.getTime());
        setTimecards(rows);
        setError(null);
      } catch (e: any) {
        console.error('[PartTimePayroll] load error', e);
        // Firestoreインデックスエラーを検出
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
  }, [userProfile?.currentOrganizationId, userProfile?.uid, selectedMonth]);

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
    const transport = orgSettings?.transportAllowanceEnabled ? (transportPerShift || orgSettings.transportAllowancePerShift || 0) : 0;
    const total = Math.round(base + night + overtime + holiday + transport);
    return { base, night, overtime, holiday, transport, total, totalMin, nightMin, overtimeMin, breakMin };
  };

  const summary = useMemo(() => {
    // 全てのステータス(下書き、申請中、承認済み、却下)を集計
    const uniqueDays = new Set<string>();
    let totalMin = 0, nightMin = 0, overtimeMin = 0;
    let base = 0, night = 0, overtime = 0, holiday = 0, transport = 0, total = 0;
    for (const s of timecards) {
      uniqueDays.add(s.dateKey);
      const bd = calcBreakdown(s);
      totalMin += bd.totalMin; nightMin += bd.nightMin; overtimeMin += bd.overtimeMin;
      base += bd.base; night += bd.night; overtime += bd.overtime; holiday += bd.holiday; transport += bd.transport; total += bd.total;
    }
    // 全てのタイムカードが承認済みかチェック
    const allApproved = timecards.length > 0 && timecards.every(t => t.status === 'approved');
    return { days: uniqueDays.size, totalMin, nightMin, overtimeMin, base, night, overtime, holiday, transport, total, allApproved };
  }, [timecards, orgSettings, transportPerShift]);

  const exportCsv = () => {
    const header = ['日付','出勤','退勤','休憩(分)','時間(分)','夜間(分)','残業(分)','時給','基本(円)','深夜(円)','残業(円)','休日(円)','交通費(円)','合計(円)'];
    const lines = [header.join(',')];
    timecards.forEach(s => {
      const bd = calcBreakdown(s);
      const hourly = s.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
      const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}) : '--:--';
      lines.push([
        s.dateKey,
        fmt(s.clockInAt),
        fmt(s.clockOutAt),
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
    a.download = `my_payroll_${y}-${String(m).padStart(2,'0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()-1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()+1, 1));

  // 打刻が完了したドラフトカードのみを対象にする
  const completedDraftCards = useMemo(() => {
    return timecards.filter(t => 
      t.status === 'draft' && 
      t.clockInAt && 
      t.clockOutAt &&
      (!t.breakStartAt || t.breakEndAt) // 休憩を開始したなら終了も必要
    );
  }, [timecards]);

  const canSubmit = useMemo(() => {
    return completedDraftCards.length > 0;
  }, [completedDraftCards]);

  const handleBulkSubmit = async () => {
    if (!userProfile?.uid || !userProfile.currentOrganizationId) return;
    
    if (completedDraftCards.length === 0) {
      alert('申請可能なタイムカードがありません。出勤・退勤が完了しているタイムカードのみ申請できます。');
      return;
    }
    
    // 未完了のドラフトカードを確認
    const incompleteDraftCards = timecards.filter(t => 
      t.status === 'draft' && 
      !completedDraftCards.some(c => c.id === t.id)
    );
    
    if (incompleteDraftCards.length > 0) {
      const incompleteList = incompleteDraftCards.map(card => {
        const issues: string[] = [];
        if (!card.clockInAt) issues.push('出勤なし');
        if (!card.clockOutAt) issues.push('退勤なし');
        if (card.breakStartAt && !card.breakEndAt) issues.push('休憩終了なし');
        return `${card.dateKey}: ${issues.join('、')}`;
      });
      
      if (!confirm(`以下のタイムカードは未完了のため申請されません:\n\n${incompleteList.join('\n')}\n\n完了済みの${completedDraftCards.length}件のタイムカードを申請しますか？`)) {
        return;
      }
    } else {
      if (!confirm(`${completedDraftCards.length}件のタイムカードを一括申請しますか？`)) {
        return;
      }
    }
    
    try {
      // 完了済みのドラフトカードのみを申請
      for (const card of completedDraftCards) {
        await updateDoc(doc(db, 'timecards', card.id), { 
          status: 'pending', 
          updatedAt: Timestamp.now() 
        });
      }
      
      alert(`${completedDraftCards.length}件の申請が完了しました`);
      // リロード
      window.location.reload();
    } catch (e) {
      console.error('[Payroll] bulk submit error', e);
      alert('申請に失敗しました');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">今月の給与一覧</h1>
          <button onClick={() => router.push('/staff/dashboard')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <p className="font-semibold text-yellow-800">{error}</p>
                <button 
                  onClick={() => window.location.reload()} 
                  className="mt-2 px-3 py-1 text-sm rounded bg-yellow-600 text-white hover:bg-yellow-700"
                >
                  再読み込み
                </button>
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
          <div className="ml-auto flex items-center gap-2">
            <button disabled={!canSubmit} onClick={handleBulkSubmit} className={`px-3 py-1 rounded text-white ${canSubmit ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300 cursor-not-allowed'}`}>一括申請</button>
            <button onClick={exportCsv} className="px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700">CSV出力</button>
          </div>
        </div>

        {/* サマリーカード */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 mb-1">出勤日数</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900">{summary.days}日</p>
          </div>
          <div className="bg-white rounded-lg shadow p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 mb-1">総労働時間</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900">{(summary.totalMin/60).toFixed(1)}h</p>
          </div>
          <div className="bg-white rounded-lg shadow p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 mb-1">深夜時間</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900">{(summary.nightMin/60).toFixed(1)}h</p>
          </div>
          <div className="bg-white rounded-lg shadow p-3 sm:p-4">
            <p className="text-xs sm:text-sm text-gray-600 mb-1">交通費合計</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900">¥{Math.round(summary.transport).toLocaleString('ja-JP')}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-3 sm:p-4 col-span-2 sm:col-span-1">
            <p className="text-xs sm:text-sm text-gray-600 mb-1">総支給額</p>
            <div className="flex items-center gap-2">
              <p className="text-xl sm:text-2xl font-bold text-gray-900">¥{Math.round(summary.total).toLocaleString('ja-JP')}</p>
              {summary.allApproved ? (
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" title="全て承認済み">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : timecards.length > 0 ? (
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3,3" viewBox="0 0 20 20" title="未確定">
                  <circle cx="10" cy="10" r="7" />
                </svg>
              ) : null}
            </div>
          </div>
        </div>

        {/* デスクトップ: テーブル表示 */}
        <div className="hidden lg:block bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 border-b text-center">日付</th>
                <th className="p-2 border-b text-center">ステータス</th>
                <th className="p-2 border-b text-center">出勤</th>
                <th className="p-2 border-b text-center">退勤</th>
                <th className="p-2 border-b text-center">休憩(分)</th>
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
                <tr><td className="p-4 text-center" colSpan={14}>読み込み中...</td></tr>
              ) : timecards.length === 0 ? (
                <tr><td className="p-4 text-center" colSpan={14}>タイムカードがありません</td></tr>
              ) : (
                timecards.map(s => {
                  const bd = calcBreakdown(s);
                  const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}) : '--:--';
                  const statusLabel = s.status === 'approved' ? '承認済み' : s.status === 'rejected' ? '却下' : s.status === 'pending' ? '申請中' : '下書き';
                  const statusColor = s.status === 'approved' ? 'bg-green-100 text-green-800' : s.status === 'rejected' ? 'bg-red-100 text-red-800' : s.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800';
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="p-2 border-b text-center">{s.dateKey}</td>
                      <td className="p-2 border-b text-center"><span className={`inline-block px-2 py-0.5 rounded text-xs ${statusColor}`}>{statusLabel}</span></td>
                      <td className="p-2 border-b text-center">{fmt(s.clockInAt)}</td>
                      <td className="p-2 border-b text-center">{fmt(s.clockOutAt)}</td>
                      <td className="p-2 border-b text-center">{bd.breakMin || 0}</td>
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
            {!loading && timecards.length > 0 && (
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="p-2 border-t text-center">合計</td>
                  <td className="p-2 border-t text-center" colSpan={4}></td>
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

        {/* モバイル: カード表示 */}
        <div className="lg:hidden space-y-3">
          {loading ? (
            <div className="bg-white rounded-lg shadow p-4 text-center">読み込み中...</div>
          ) : timecards.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-4 text-center">タイムカードがありません</div>
          ) : (
            timecards.map(s => {
              const bd = calcBreakdown(s);
              const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}) : '--:--';
              const statusLabel = s.status === 'approved' ? '承認済み' : s.status === 'rejected' ? '却下' : s.status === 'pending' ? '申請中' : '下書き';
              const statusColor = s.status === 'approved' ? 'bg-green-100 text-green-800' : s.status === 'rejected' ? 'bg-red-100 text-red-800' : s.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800';
              return (
                <div key={s.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold text-base">{s.dateKey}</div>
                    <span className={`px-2 py-1 rounded text-xs ${statusColor}`}>{statusLabel}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-gray-600">出勤:</span> <span className="font-medium">{fmt(s.clockInAt)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">退勤:</span> <span className="font-medium">{fmt(s.clockOutAt)}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">休憩:</span> <span className="font-medium">{bd.breakMin}分</span>
                    </div>
                    <div>
                      <span className="text-gray-600">勤務:</span> <span className="font-medium">{bd.totalMin}分</span>
                    </div>
                    {bd.nightMin > 0 && (
                      <div>
                        <span className="text-gray-600">深夜:</span> <span className="font-medium">{bd.nightMin}分</span>
                      </div>
                    )}
                    {bd.overtimeMin > 0 && (
                      <div>
                        <span className="text-gray-600">残業:</span> <span className="font-medium">{bd.overtimeMin}分</span>
                      </div>
                    )}
                  </div>
                  <div className="border-t pt-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">基本給</span>
                      <span className="font-medium">¥{Math.round(bd.base).toLocaleString('ja-JP')}</span>
                    </div>
                    {bd.night > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">深夜手当</span>
                        <span className="font-medium">¥{Math.round(bd.night).toLocaleString('ja-JP')}</span>
                      </div>
                    )}
                    {bd.overtime > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">残業手当</span>
                        <span className="font-medium">¥{Math.round(bd.overtime).toLocaleString('ja-JP')}</span>
                      </div>
                    )}
                    {bd.holiday > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">休日手当</span>
                        <span className="font-medium">¥{Math.round(bd.holiday).toLocaleString('ja-JP')}</span>
                      </div>
                    )}
                    {bd.transport > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">交通費</span>
                        <span className="font-medium">¥{Math.round(bd.transport).toLocaleString('ja-JP')}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-2 border-t font-semibold text-base">
                      <span>合計</span>
                      <span className="text-emerald-600">¥{Math.round(bd.total).toLocaleString('ja-JP')}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
