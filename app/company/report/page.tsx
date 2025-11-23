'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, getDocs, Timestamp, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import JapaneseHolidays from 'japanese-holidays';
import toast from 'react-hot-toast';

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
  const [savedReport, setSavedReport] = useState<any>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userTimecards, setUserTimecards] = useState<any[]>([]);
  const [orgSettings, setOrgSettings] = useState<any>(null);
  const [memberTransport, setMemberTransport] = useState<number>(0);

  useEffect(() => {
    if (!userProfile) return;
    if (!userProfile.isManage) {
      router.push('/staff/dashboard');
      return;
    }
  }, [userProfile, router]);

  useEffect(() => {
    const load = async () => {
      if (!userProfile?.currentOrganizationId) return;
      setLoading(true);
      try {
        // 組織設定を取得
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
        
        // 保存済みレポートを読み込み
        const y = selectedMonth.getFullYear();
        const m = selectedMonth.getMonth() + 1;
        const monthKey = `${y}-${String(m).padStart(2, '0')}`;
        
        // 該当月の全ユーザーのレポートを取得
        const q = query(
          collection(db, 'monthlyReports'),
          where('organizationId', '==', userProfile.currentOrganizationId),
          where('year', '==', y),
          where('month', '==', m)
        );
        const snap = await getDocs(q);
        
        if (snap.empty) {
          // 保存済みレポートがない
          setSavedReport(null);
          setError(null);
          setLoading(false);
          return;
        }
        
        // 保存済みレポートからデータを構築（status='confirmed'のみ）
        const reports: UserReport[] = [];
        snap.forEach(d => {
          const data = d.data();
          // 確定済み(confirmed)のレポートのみ表示、差し戻し済み(reverted)は除外
          if (data.status === 'confirmed') {
            reports.push({
              userId: data.userId,
              userName: data.userName,
              avatarUrl: '', // アバターURLは不要なので空文字
              workDays: data.workDays || 0,
              totalMinutes: data.totalWorkMinutes || 0,
              nightMinutes: data.totalNightMinutes || 0,
              overtimeMinutes: data.totalOvertimeMinutes || 0,
              base: data.baseWage || 0,
              night: data.nightPremium || 0,
              overtime: data.overtimePremium || 0,
              holiday: data.holidayPremium || 0,
              transport: data.transportAllowance || 0,
              total: data.totalAmount || 0,
            });
          }
        });
        setSavedReport({ userReports: reports });

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

  // ユーザー別集計
  const userReports = useMemo(() => {
    // 保存済みレポートがあればそれを使用
    if (savedReport && savedReport.userReports) {
      return (savedReport.userReports as UserReport[]).sort((a, b) => a.userName.localeCompare(b.userName));
    }
    
    return [];
  }, [savedReport]);

  const summary = useMemo(() => {
    // userReportsから集計
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

  // ユーザー詳細を表示（タイムカード一覧を取得）
  const showUserDetail = async (userId: string) => {
    if (!userProfile?.currentOrganizationId) return;
    
    try {
      const y = selectedMonth.getFullYear();
      const m = selectedMonth.getMonth();
      const startKey = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const endY = m === 11 ? y + 1 : y;
      const endM = m === 11 ? 0 : m + 1;
      const endKey = `${endY}-${String(endM + 1).padStart(2, '0')}-01`;

      // 該当月の承認済みタイムカードを取得（参照用）
      const q = query(
        collection(db, 'timecards'),
        where('organizationId', '==', userProfile.currentOrganizationId),
        where('userId', '==', userId),
        where('status', '==', 'approved'),
        where('dateKey', '>=', startKey),
        where('dateKey', '<', endKey)
      );
      const snap = await getDocs(q);
      
      const cards = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      })).sort((a: any, b: any) => a.dateKey.localeCompare(b.dateKey));
      
      setUserTimecards(cards);
      setSelectedUserId(userId);
    } catch (e) {
      console.error('[Report] Failed to load user timecards', e);
      toast.error('タイムカードの読み込みに失敗しました');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">給与レポート（確定済み）</h1>
          <button onClick={() => router.push('/company/dashboard')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
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
          {savedReport && (
            <div className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-800 rounded">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium">承認済み</span>
            </div>
          )}
          <div className="ml-auto">
            <button onClick={exportCsv} disabled={userReports.length === 0} className={`px-3 py-1 rounded ${userReports.length === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>CSV出力</button>
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
        ) : (
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
                </tr>
              </thead>
              <tbody>
                {userReports.length === 0 ? (
                  <tr><td className="p-8 text-center text-gray-500" colSpan={11}>{savedReport === null ? 'この月のレポートはまだ作成されていません。給与明細ページで承認を行うとレポートが作成されます。' : '該当月の承認済みタイムカードがありません'}</td></tr>
                ) : (
                  userReports.map(r => (
                    <tr key={r.userId} className="hover:bg-gray-50 cursor-pointer" onClick={() => showUserDetail(r.userId)}>
                      <td className="p-3 border-b">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-white text-xs font-semibold">
                            {r.userName.charAt(0)}
                          </div>
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-sm text-gray-600 space-y-1">
          {savedReport ? (
            <>
              <p>※ このレポートは承認済みです。給与明細ページで追加承認を行うと自動的に更新されます。</p>
            </>
          ) : (
            <>
              <p>※ この月のレポートはまだ作成されていません</p>
              <p>※ 給与明細ページでタイムカードを承認すると、レポートが自動的に作成されます</p>
            </>
          )}
        </div>
      </div>

      {/* ユーザー詳細モーダル */}
      {selectedUserId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedUserId(null)}>
          <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-xl font-bold">{userReports.find(r => r.userId === selectedUserId)?.userName}の勤怠詳細</h2>
                  <p className="text-sm text-gray-600">{selectedMonth.getFullYear()}年{selectedMonth.getMonth() + 1}月</p>
                </div>
              </div>
              <button onClick={() => setSelectedUserId(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6">
              {/* 月次レポートサマリー */}
              {(() => {
                const userReport = userReports.find(r => r.userId === selectedUserId);
                if (!userReport) return null;
                
                return (
                  <div className="mb-6 bg-blue-50 rounded-lg p-4">
                    <h3 className="font-semibold mb-3 text-blue-900">月次確定レポート</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600">出勤日数</p>
                        <p className="font-semibold text-lg">{userReport.workDays}日</p>
                      </div>
                      <div>
                        <p className="text-gray-600">基本給</p>
                        <p className="font-semibold text-lg">¥{Math.round(userReport.base).toLocaleString('ja-JP')}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">深夜手当</p>
                        <p className="font-semibold text-lg">¥{Math.round(userReport.night).toLocaleString('ja-JP')}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">残業手当</p>
                        <p className="font-semibold text-lg">¥{Math.round(userReport.overtime).toLocaleString('ja-JP')}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">休日手当</p>
                        <p className="font-semibold text-lg">¥{Math.round(userReport.holiday).toLocaleString('ja-JP')}</p>
                      </div>
                      <div>
                        <p className="text-gray-600">交通費</p>
                        <p className="font-semibold text-lg">¥{Math.round(userReport.transport).toLocaleString('ja-JP')}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-gray-600">総支給額</p>
                        <p className="font-semibold text-2xl text-emerald-600">¥{Math.round(userReport.total).toLocaleString('ja-JP')}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-3">※ この金額は承認時点で確定した値です</p>
                  </div>
                );
              })()}
              
              {/* タイムカード詳細（参考情報） */}
              <h3 className="font-semibold mb-2 text-gray-700">タイムカード明細（参考）</h3>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 border-b text-center">日付</th>
                    <th className="p-2 border-b text-center">出勤</th>
                    <th className="p-2 border-b text-center">退勤</th>
                    <th className="p-2 border-b text-center">休憩(分)</th>
                    <th className="p-2 border-b text-center">勤務(分)</th>
                    <th className="p-2 border-b text-center">時給</th>
                  </tr>
                </thead>
                <tbody>
                  {userTimecards.length === 0 ? (
                    <tr><td className="p-4 text-center text-gray-500" colSpan={6}>タイムカードがありません</td></tr>
                  ) : (
                    userTimecards.map((tc: any) => {
                      const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                      const workMinutes = tc.clockInAt && tc.clockOutAt 
                        ? Math.max(0, Math.floor((tc.clockOutAt.toMillis() - tc.clockInAt.toMillis()) / 60000))
                        : 0;
                      const breakMinutes = tc.breakStartAt && tc.breakEndAt
                        ? Math.max(0, Math.floor((tc.breakEndAt.toMillis() - tc.breakStartAt.toMillis()) / 60000))
                        : 0;
                      const netMinutes = workMinutes - breakMinutes;
                      
                      return (
                        <tr key={tc.id} className="hover:bg-gray-50">
                          <td className="p-2 border-b text-center">{tc.dateKey}</td>
                          <td className="p-2 border-b text-center">{fmt(tc.clockInAt)}</td>
                          <td className="p-2 border-b text-center">{fmt(tc.clockOutAt)}</td>
                          <td className="p-2 border-b text-center">{breakMinutes}分</td>
                          <td className="p-2 border-b text-center">{netMinutes}分</td>
                          <td className="p-2 border-b text-center">¥{(tc.hourlyWage || 0).toLocaleString()}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 mt-2">※ 給与計算は monthlyReports の確定値を使用しています</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
