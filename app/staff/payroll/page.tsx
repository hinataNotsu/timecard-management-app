'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { collection, doc, getDoc, getDocs, orderBy, query, where, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import JapaneseHolidays from 'japanese-holidays';
import { useToast } from '@/components/Toast';

// 休憩期間の型
interface BreakPeriod {
  startAt: Timestamp;
  endAt?: Timestamp;
}

interface TimecardRow {
  id: string;
  dateKey: string;
  date: Date;
  clockInAt?: Timestamp;
  breaks: BreakPeriod[]; // 複数休憩対応
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

  // Toast
  const { showSuccessToast, showErrorToast, showConfirmToast, showInfoToast } = useToast();

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
              holidayIncludesWeekend: !!o.holidayIncludesWeekend,
              transportAllowanceEnabled: !!o.transportAllowanceEnabled,
              transportAllowancePerShift: Number(o.transportAllowancePerShift ?? 0),
            });
          }
        } catch (e) {
          console.error('[PartTimePayroll] Error loading org settings:', e);
        }

        // メンバー個別の交通費取得
        try {
          const memRef = doc(db, 'organizations', userProfile.currentOrganizationId, 'members', userProfile.uid);
          const memSnap = await getDoc(memRef);
          if (memSnap.exists()) {
            const mdata = memSnap.data() as any;
            if (mdata.transportAllowance !== undefined) {
              setTransportPerShift(Number(mdata.transportAllowance));
            }
          }
        } catch (e) {
          console.error('[PartTimePayroll] Error loading member transport:', e);
        }

        // タイムカード取得
        const y = selectedMonth.getFullYear();
        const m = selectedMonth.getMonth();
        const startKey = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        const endKey = `${m === 11 ? y + 1 : y}-${String(m === 11 ? 1 : m + 2).padStart(2, '0')}-01`;
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
          const [dy, dm, dd] = data.dateKey.split('-').map(Number);
          rows.push({
            id: d.id,
            dateKey: data.dateKey,
            date: new Date(dy, dm - 1, dd),
            clockInAt: data.clockInAt,
            breaks: data.breaks || [], // 配列として取得
            clockOutAt: data.clockOutAt,
            hourlyWage: data.hourlyWage,
            status: data.status || 'approved',
          });
        }
        rows.sort((a, b) => a.date.getTime() - b.date.getTime());
        setTimecards(rows);
        setError(null);
      } catch (e: any) {
        console.error('[PartTimePayroll] load error', e);
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

  // 複数休憩の合計時間を計算
  const calcTotalBreakMinutes = (breaks: BreakPeriod[]): number => {
    if (!breaks || breaks.length === 0) return 0;
    let total = 0;
    for (const b of breaks) {
      if (b.startAt && b.endAt) {
        total += Math.max(0, Math.round((b.endAt.toMillis() - b.startAt.toMillis()) / 60000));
      }
    }
    return total;
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
    const breakMin = calcTotalBreakMinutes(row.breaks); // 配列から計算
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
    const uniqueDays = new Set<string>();
    let totalMin = 0, nightMin = 0, overtimeMin = 0;
    let base = 0, night = 0, overtime = 0, holiday = 0, transport = 0, total = 0;
    for (const s of timecards) {
      uniqueDays.add(s.dateKey);
      const bd = calcBreakdown(s);
      totalMin += bd.totalMin; nightMin += bd.nightMin; overtimeMin += bd.overtimeMin;
      base += bd.base; night += bd.night; overtime += bd.overtime; holiday += bd.holiday; transport += bd.transport; total += bd.total;
    }
    const allApproved = timecards.length > 0 && timecards.every(t => t.status === 'approved');
    return { days: uniqueDays.size, totalMin, nightMin, overtimeMin, base, night, overtime, holiday, transport, total, allApproved };
  }, [timecards, orgSettings, transportPerShift]);

  const exportCsv = () => {
    const header = ['日付', '出勤', '退勤', '休憩(分)', '時間(分)', '夜間(分)', '残業(分)', '時給', '基本(円)', '深夜(円)', '残業(円)', '休日(円)', '交通費(円)', '合計(円)'];
    const lines = [header.join(',')];
    timecards.forEach(s => {
      const bd = calcBreakdown(s);
      const hourly = s.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
      const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '--:--';
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
    a.download = `my_payroll_${y}-${String(m).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));

  // 休憩が完了しているかチェック（最後の休憩にendAtがあるか）
  const isBreakComplete = (breaks: BreakPeriod[]): boolean => {
    if (breaks.length === 0) return true;
    const lastBreak = breaks[breaks.length - 1];
    return !!lastBreak.endAt;
  };

  // 打刻が完了したドラフトカードのみを対象にする
  const completedDraftCards = useMemo(() => {
    return timecards.filter(t =>
      t.status === 'draft' &&
      t.clockInAt &&
      t.clockOutAt &&
      isBreakComplete(t.breaks) // 休憩が完了しているか
    );
  }, [timecards]);

  const canSubmit = useMemo(() => {
    return completedDraftCards.length > 0;
  }, [completedDraftCards]);

  const handleBulkSubmit = async () => {
    if (!userProfile?.uid || !userProfile.currentOrganizationId) return;

    if (completedDraftCards.length === 0) {
      showInfoToast('申請可能なタイムカードがありません。出勤・退勤が完了しているタイムカードのみ申請できます。');
      return;
    }

    // 未完了のドラフトカードを確認
    const incompleteDraftCards = timecards.filter(t =>
      t.status === 'draft' &&
      !completedDraftCards.some(c => c.id === t.id)
    );

    let confirmMessage = '';
    if (incompleteDraftCards.length > 0) {
      const incompleteList = incompleteDraftCards.map(card => {
        const issues: string[] = [];
        if (!card.clockInAt) issues.push('出勤なし');
        if (!card.clockOutAt) issues.push('退勤なし');
        if (!isBreakComplete(card.breaks)) issues.push('休憩終了なし');
        return `${card.dateKey}: ${issues.join(', ')}`;
      });
      confirmMessage = `以下のタイムカードは未完了のため申請されません:\n${incompleteList.join('\n')}\n\n完了済みの${completedDraftCards.length}件を申請しますか？`;
    } else {
      confirmMessage = `${completedDraftCards.length}件のタイムカードを申請しますか？`;
    }

    const confirmed = await showConfirmToast(confirmMessage, {
      title: 'タイムカード申請',
      confirmText: '申請する',
      cancelText: 'キャンセル',
    });

    if (!confirmed) return;

    try {
      const now = Timestamp.now();
      for (const card of completedDraftCards) {
        await updateDoc(doc(db, 'timecards', card.id), {
          status: 'pending',
          updatedAt: now,
        });
      }
      setTimecards(prev => prev.map(t =>
        completedDraftCards.some(c => c.id === t.id)
          ? { ...t, status: 'pending' }
          : t
      ));
      showSuccessToast(`${completedDraftCards.length}件のタイムカードを申請しました`);
    } catch (e) {
      console.error('[PartTimePayroll] submit error', e);
      showErrorToast('申請に失敗しました');
    }
  };

  // ステータスバッジ
  const StatusBadge = ({ status }: { status: string }) => {
    const styles: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-600',
      pending: 'bg-yellow-100 text-yellow-700',
      approved: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, string> = {
      draft: '下書き',
      pending: '申請中',
      approved: '承認済',
      rejected: '却下',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
        {labels[status] || status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* ヘッダー */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">給与明細</h1>
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">←</button>
              <span className="font-semibold">
                {selectedMonth.getFullYear()}年{selectedMonth.getMonth() + 1}月
              </span>
              <button onClick={nextMonth} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">→</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700"
            >
              CSV出力
            </button>
            <button
              onClick={() => router.push('/staff/dashboard')}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              ← ダッシュボード
            </button>
          </div>
        </div>

        {/* サマリー */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <div className="text-gray-500 text-sm">出勤日数</div>
              <div className="text-2xl font-bold">{summary.days}日</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500 text-sm">総勤務時間</div>
              <div className="text-2xl font-bold">{Math.floor(summary.totalMin / 60)}時間{summary.totalMin % 60}分</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500 text-sm">深夜時間</div>
              <div className="text-2xl font-bold">{Math.floor(summary.nightMin / 60)}時間{summary.nightMin % 60}分</div>
            </div>
            <div className="text-center">
              <div className="text-gray-500 text-sm">残業時間</div>
              <div className="text-2xl font-bold">{Math.floor(summary.overtimeMin / 60)}時間{summary.overtimeMin % 60}分</div>
            </div>
          </div>
          <div className="border-t pt-4">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-sm">
              <div><span className="text-gray-500">基本給:</span> ¥{Math.round(summary.base).toLocaleString()}</div>
              <div><span className="text-gray-500">深夜:</span> ¥{Math.round(summary.night).toLocaleString()}</div>
              <div><span className="text-gray-500">残業:</span> ¥{Math.round(summary.overtime).toLocaleString()}</div>
              <div><span className="text-gray-500">休日:</span> ¥{Math.round(summary.holiday).toLocaleString()}</div>
              <div><span className="text-gray-500">交通費:</span> ¥{Math.round(summary.transport).toLocaleString()}</div>
              <div className="font-bold text-blue-600">合計: ¥{summary.total.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* 一括申請ボタン */}
        {completedDraftCards.length > 0 && (
          <div className="mb-4 flex justify-end">
            <button
              onClick={handleBulkSubmit}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              下書き{completedDraftCards.length}件を一括申請
            </button>
          </div>
        )}

        {/* タイムカード一覧 */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 border-b text-left">日付</th>
                <th className="p-3 border-b text-center">出勤</th>
                <th className="p-3 border-b text-center">退勤</th>
                <th className="p-3 border-b text-center">休憩(分)</th>
                <th className="p-3 border-b text-center">勤務(分)</th>
                <th className="p-3 border-b text-center">時給</th>
                <th className="p-3 border-b text-center">合計</th>
                <th className="p-3 border-b text-center">状態</th>
              </tr>
            </thead>
            <tbody>
              {timecards.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-500">
                    タイムカードがありません
                  </td>
                </tr>
              ) : (
                timecards.map((tc) => {
                  const bd = calcBreakdown(tc);
                  const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                  return (
                    <tr key={tc.id} className="hover:bg-gray-50">
                      <td className="p-3 border-b">{tc.dateKey}</td>
                      <td className="p-3 border-b text-center">{fmt(tc.clockInAt)}</td>
                      <td className="p-3 border-b text-center">{fmt(tc.clockOutAt)}</td>
                      <td className="p-3 border-b text-center">{bd.breakMin}</td>
                      <td className="p-3 border-b text-center">{bd.totalMin}</td>
                      <td className="p-3 border-b text-center">¥{tc.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100}</td>
                      <td className="p-3 border-b text-center font-semibold">¥{bd.total.toLocaleString()}</td>
                      <td className="p-3 border-b text-center">
                        <StatusBadge status={tc.status} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}