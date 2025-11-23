'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import OrganizationSelector from '@/components/OrganizationSelector';
import { collection, doc, getDoc, getDocs, orderBy, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import JapaneseHolidays from 'japanese-holidays';

type ShiftRow = {
  date: Date;
  startTime: string;
  endTime: string;
  status: 'pending' | 'approved' | 'rejected';
  hourlyWage?: number;
};

export default function PartTimeDashboard() {
  const { userProfile, loading, signOut } = useAuth();
  const router = useRouter();
  const [monthShifts, setMonthShifts] = useState<ShiftRow[]>([]);
  const [includePending, setIncludePending] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState(new Date()); // 給与表示用の月
  const [payrollData, setPayrollData] = useState<{
    total: number;
    status: 'estimated' | 'pending' | 'approved';
    minutes: number;
  } | null>(null);
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
    isWatchAdmin: boolean;
  } | null>(null);
  const [myTransportPerShift, setMyTransportPerShift] = useState<number>(0);
  const [orgSettingsLoaded, setOrgSettingsLoaded] = useState(false);

  useEffect(() => {
    if (!loading && !isLoggingOut) {
      if (!userProfile) {
        router.push('/auth/login/part-time');
      } else if (!userProfile.organizationIds || userProfile.organizationIds.length === 0) {
        router.push('/onboarding/join-organization');
      }
    }
  }, [userProfile, loading, isLoggingOut, router]);

  // 今月の自分のシフト + 組織設定 + 自分の交通費設定を取得
  useEffect(() => {
    // 組織が変わったらロード状態をリセット
    setOrgSettingsLoaded(false);
    
    const load = async () => {
      if (!userProfile?.currentOrganizationId || !userProfile?.uid) return;
      try {
        const orgId = userProfile.currentOrganizationId;
        // 組織設定
        try {
          const orgSnap = await getDoc(doc(db, 'organizations', orgId));
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
              isWatchAdmin: o.isWatchAdmin === true, // デフォルトfalse（初期非表示）
            });
          }
        } catch {}

        // 自分の交通費設定
        try {
          const memSnap = await getDoc(doc(db, 'organizations', orgId, 'members', userProfile.uid));
          const v = memSnap.exists() ? Number((memSnap.data() as any).transportAllowancePerShift ?? 0) : 0;
          setMyTransportPerShift(Number.isFinite(v) ? v : 0);
        } catch {}
        
        // 組織設定と交通費設定のロード完了をマーク
        setOrgSettingsLoaded(true);

        // 今月の自分のシフト
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
        const userRef = doc(db, 'users', userProfile.uid);
        // 既存インデックス (organizationId + userRef + date) を前提にクエリ
        const qy = query(
          collection(db, 'shifts'),
          where('organizationId', '==', orgId),
          where('userRef', '==', userRef),
          where('date', '>=', Timestamp.fromDate(monthStart)),
          where('date', '<', Timestamp.fromDate(nextMonthStart)),
          orderBy('date', 'asc')
        );
        const snap = await getDocs(qy);
        const list: ShiftRow[] = [];
        snap.forEach(d => {
          const data = d.data() as any;
          list.push({
            date: (data.date as Timestamp).toDate(),
            startTime: data.startTime,
            endTime: data.endTime,
            status: (data.status as any) || 'pending',
            hourlyWage: data.hourlyWage != null ? Number(data.hourlyWage) : undefined,
          });
        });
        setMonthShifts(list);
      } catch (e) {
        console.error('[Part-time Dashboard] load error', e);
      }
    };
    load();
  }, [userProfile?.currentOrganizationId, userProfile?.uid]);

  // 選択した月の給与データを取得
  useEffect(() => {
    const loadPayroll = async () => {
      if (!userProfile?.currentOrganizationId || !userProfile?.uid || !orgSettings) return;
      
      try {
        const orgId = userProfile.currentOrganizationId;
        const monthStart = new Date(selectedPayrollMonth.getFullYear(), selectedPayrollMonth.getMonth(), 1, 0, 0, 0, 0);
        const nextMonthStart = new Date(selectedPayrollMonth.getFullYear(), selectedPayrollMonth.getMonth() + 1, 1, 0, 0, 0, 0);
        const now = new Date();
        const isCurrentMonth = selectedPayrollMonth.getFullYear() === now.getFullYear() && selectedPayrollMonth.getMonth() === now.getMonth();
        
        // タイムカードから給与を計算
        const timecardsQuery = query(
          collection(db, 'timecards'),
          where('organizationId', '==', orgId),
          where('userId', '==', userProfile.uid),
          where('dateKey', '>=', monthStart.toISOString().split('T')[0]),
          where('dateKey', '<', nextMonthStart.toISOString().split('T')[0])
        );
        
        const timecardsSnap = await getDocs(timecardsQuery);
        const timecards = timecardsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
        
        // 承認済みタイムカードがあるかチェック
        const approvedCards = timecards.filter(tc => tc.status === 'approved');
        const pendingCards = timecards.filter(tc => tc.status === 'pending');
        const hasApproved = approvedCards.length > 0;
        const hasPending = pendingCards.length > 0;
        
        let total = 0;
        let minutes = 0;
        let status: 'estimated' | 'pending' | 'approved' = 'estimated';
        
        if (hasApproved) {
          // 承認済みがあれば確定給与として計算
          status = 'approved';
          for (const tc of approvedCards) {
            if (tc.clockInAt && tc.clockOutAt) {
              const clockIn = (tc.clockInAt as Timestamp).toDate();
              const clockOut = (tc.clockOutAt as Timestamp).toDate();
              const breakMin = tc.breakMinutes ?? 0;
              const workMin = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 60000 - breakMin);
              minutes += workMin;
              
              const hourly = tc.hourlyWage ?? orgSettings.defaultHourlyWage;
              let amount = hourly * (workMin / 60);
              
              // 各種割増計算
              if (tc.nightPremiumAmount) amount += Number(tc.nightPremiumAmount);
              if (tc.overtimePremiumAmount) amount += Number(tc.overtimePremiumAmount);
              if (tc.holidayPremiumAmount) amount += Number(tc.holidayPremiumAmount);
              
              // 交通費を加算（タイムカードに保存されている値、または組織設定に基づいて計算）
              if (tc.transportAllowance != null && tc.transportAllowance !== undefined) {
                amount += Number(tc.transportAllowance);
              } else if (orgSettings.transportAllowanceEnabled && myTransportPerShift > 0) {
                amount += myTransportPerShift;
              }
              
              total += Math.round(amount);
            }
          }
        } else if (hasPending) {
          // 申請中のみの場合
          status = 'pending';
          for (const tc of pendingCards) {
            if (tc.clockInAt && tc.clockOutAt) {
              const clockIn = (tc.clockInAt as Timestamp).toDate();
              const clockOut = (tc.clockOutAt as Timestamp).toDate();
              const breakMin = tc.breakMinutes ?? 0;
              const workMin = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 60000 - breakMin);
              minutes += workMin;
              
              const hourly = tc.hourlyWage ?? orgSettings.defaultHourlyWage;
              let amount = hourly * (workMin / 60);
              
              if (tc.nightPremiumAmount) amount += Number(tc.nightPremiumAmount);
              if (tc.overtimePremiumAmount) amount += Number(tc.overtimePremiumAmount);
              if (tc.holidayPremiumAmount) amount += Number(tc.holidayPremiumAmount);
              
              // 交通費を加算
              if (tc.transportAllowance != null && tc.transportAllowance !== undefined) {
                amount += Number(tc.transportAllowance);
              } else if (orgSettings.transportAllowanceEnabled && myTransportPerShift > 0) {
                amount += myTransportPerShift;
              }
              
              total += Math.round(amount);
            }
          }
        } else if (isCurrentMonth) {
          // 今月でタイムカードがない場合はシフトベースの見込み
          status = 'estimated';
          const userRef = doc(db, 'users', userProfile.uid);
          const shiftsQuery = query(
            collection(db, 'shifts'),
            where('organizationId', '==', orgId),
            where('userRef', '==', userRef),
            where('date', '>=', Timestamp.fromDate(monthStart)),
            where('date', '<', Timestamp.fromDate(nextMonthStart)),
            orderBy('date', 'asc')
          );
          
          const shiftsSnap = await getDocs(shiftsQuery);
          const shifts = shiftsSnap.docs.map(d => d.data()) as any[];
          const eligibleShifts = shifts.filter(s => 
            includePending ? (s.status === 'approved' || s.status === 'pending') : s.status === 'approved'
          );
          
          for (const s of eligibleShifts) {
            const hourly = s.hourlyWage ?? orgSettings.defaultHourlyWage;
            const m = minutesBetween(s.startTime, s.endTime);
            minutes += m;
            let amount = hourly * (m / 60);
            
            if (orgSettings.nightPremiumEnabled) {
              const nm = calcNightMinutes(s.startTime, s.endTime, orgSettings.nightStart, orgSettings.nightEnd);
              amount += hourly * (nm / 60) * orgSettings.nightPremiumRate;
            }
            if (orgSettings.overtimePremiumEnabled) {
              const otm = Math.max(0, m - (orgSettings.overtimeDailyThresholdMinutes ?? 480));
              if (otm > 0) amount += hourly * (otm / 60) * (orgSettings.overtimePremiumRate ?? 0.25);
            }
            if (orgSettings.holidayPremiumEnabled) {
              const d = (s.date as Timestamp).toDate();
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              const holiday = !!JapaneseHolidays.isHoliday(d);
              const isHol = (orgSettings.holidayIncludesWeekend && weekend) || holiday;
              if (isHol) amount += hourly * (m / 60) * (orgSettings.holidayPremiumRate ?? 0.35);
            }
            if (orgSettings.transportAllowanceEnabled) {
              amount += myTransportPerShift ?? 0;
            }
            total += Math.round(amount);
          }
        }
        
        setPayrollData({ total, status, minutes });
      } catch (e) {
        console.error('[Payroll Data] load error', e);
        setPayrollData(null);
      }
    };
    
    if (orgSettings && orgSettingsLoaded) {
      loadPayroll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedPayrollMonth, 
    userProfile?.currentOrganizationId, 
    userProfile?.uid, 
    includePending,
    orgSettingsLoaded,
  ]);

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
    if (!orgSettings) return 0;
    if (ns <= ne) return overlap(s, e, ns, ne);
    return overlap(s, e, ns, 1440) + overlap(s, e, 0, ne);
  };

  const eligibleShifts = useMemo(() => {
    return monthShifts.filter(s => (includePending ? (s.status === 'approved' || s.status === 'pending') : s.status === 'approved'));
  }, [monthShifts, includePending]);

  const estimate = useMemo(() => {
    if (!orgSettings) return { total: 0, minutes: 0 };
    let total = 0;
    let minutes = 0;
    for (const s of eligibleShifts) {
      const hourly = s.hourlyWage ?? orgSettings.defaultHourlyWage;
      const m = minutesBetween(s.startTime, s.endTime);
      minutes += m;
      let amount = hourly * (m / 60);
      if (orgSettings.nightPremiumEnabled) {
        const nm = calcNightMinutes(s.startTime, s.endTime, orgSettings.nightStart, orgSettings.nightEnd);
        amount += hourly * (nm / 60) * orgSettings.nightPremiumRate;
      }
      if (orgSettings.overtimePremiumEnabled) {
        const otm = Math.max(0, m - (orgSettings.overtimeDailyThresholdMinutes ?? 480));
        if (otm > 0) amount += hourly * (otm / 60) * (orgSettings.overtimePremiumRate ?? 0.25);
      }
      if (orgSettings.holidayPremiumEnabled) {
        const d = s.date;
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        const holiday = !!JapaneseHolidays.isHoliday(d);
        const isHol = (orgSettings.holidayIncludesWeekend && weekend) || holiday;
        if (isHol) amount += hourly * (m / 60) * (orgSettings.holidayPremiumRate ?? 0.35);
      }
      if (orgSettings.transportAllowanceEnabled) {
        amount += myTransportPerShift ?? 0;
      }
      total += Math.round(amount);
    }
    return { total, minutes };
  }, [eligibleShifts, orgSettings, myTransportPerShift]);

  const handleSignOut = async () => {
    setIsLoggingOut(true);
    await signOut();
    router.push('/');
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

  if (!userProfile || !userProfile.organizationIds || userProfile.organizationIds.length === 0) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-safe">
      {/* ヘッダー */}
      <header className="bg-white shadow sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            {/* タイトルと組織セレクター */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">アルバイトダッシュボード</h1>
              <div className="w-full sm:w-auto">
                <OrganizationSelector />
              </div>
            </div>
            {/* ログアウトボタン */}
            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition text-sm sm:text-base whitespace-nowrap self-end sm:self-auto"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* シフト提出カード */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">シフト提出</h2>
            <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">今月のシフトを提出しましょう</p>
            <button
              onClick={() => router.push('/staff/shifts/request')}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 active:bg-blue-800 transition text-sm sm:text-base"
            >
              シフトを提出
            </button>
          </div>

          {/* シフト一覧カード（承認済みの月間カレンダー） */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">シフト一覧</h2>
            <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">承認済みのシフト（月間）を全員分で確認</p>
            <button 
              onClick={() => router.push('/staff/shifts/schedule')} 
              className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 active:bg-green-800 transition text-sm sm:text-base"
            >
              承認済みカレンダーを見る
            </button>
          </div>

          {/* 給与一覧カード */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">給与一覧</h2>
            <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">承認済みシフトから計算された給与を確認</p>
            <button
              onClick={() => router.push('/staff/payroll')}
              className="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 active:bg-purple-800 transition text-sm sm:text-base"
            >
              今月の給与一覧へ
            </button>
          </div>

          {/* 月次給与カード */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            {/* 月選択ヘッダー */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => {
                  const prev = new Date(selectedPayrollMonth);
                  prev.setMonth(prev.getMonth() - 1);
                  setSelectedPayrollMonth(prev);
                }}
                className="p-2 hover:bg-gray-100 rounded-full transition"
                aria-label="前の月"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              <div className="text-center flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">
                  {selectedPayrollMonth.getFullYear()}年{selectedPayrollMonth.getMonth() + 1}月
                </h2>
                {payrollData && (
                  <p className="text-xs text-gray-500 mt-1">
                    {payrollData.status === 'approved' ? '確定' : payrollData.status === 'pending' ? '申請中' : '見込み'}
                  </p>
                )}
              </div>
              
              <button
                onClick={() => {
                  const next = new Date(selectedPayrollMonth);
                  next.setMonth(next.getMonth() + 1);
                  setSelectedPayrollMonth(next);
                }}
                className="p-2 hover:bg-gray-100 rounded-full transition"
                aria-label="次の月"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* 給与表示 */}
            <div className="text-center py-4">
              {payrollData ? (
                <>
                  <p className={`text-2xl sm:text-3xl font-bold mb-2 ${
                    payrollData.status === 'approved' ? 'text-green-600' : 
                    payrollData.status === 'pending' ? 'text-yellow-600' : 
                    'text-gray-900'
                  }`}>
                    ¥{payrollData.total.toLocaleString('ja-JP')}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-600">
                    {payrollData.status === 'estimated' 
                      ? `対象シフト: ${(payrollData.minutes / 60).toFixed(1)}時間` 
                      : `勤務時間: ${(payrollData.minutes / 60).toFixed(1)}時間`}
                  </p>
                  {payrollData.status === 'approved' && (
                    <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      承認済み
                    </div>
                  )}
                  {payrollData.status === 'pending' && (
                    <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                      </svg>
                      申請中
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">データがありません</p>
              )}
            </div>

            {/* 今月に戻るボタン */}
            {selectedPayrollMonth.getMonth() !== new Date().getMonth() && (
              <button
                onClick={() => setSelectedPayrollMonth(new Date())}
                className="w-full mt-3 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition"
              >
                今月に戻る
              </button>
            )}
          </div>

          {/* タイムカードカード - isWatchAdminがfalse（初期値）の時のみ表示 */}
          {orgSettings && orgSettings.isWatchAdmin === false && (
            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">タイムカード</h2>
              <p className="text-sm sm:text-base text-gray-600 mb-3 sm:mb-4">出退勤の打刻</p>
              <button
                onClick={() => router.push('/staff/timecard')}
                className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 active:bg-indigo-800 transition text-sm sm:text-base"
              >
                タイムカードページへ
              </button>
            </div>
          )}

          {/* プロフィールカード */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">プロフィール</h2>
            <p className="text-xs sm:text-sm text-gray-600 mb-2 break-all">メール: {userProfile.email}</p>
            <p className="text-xs sm:text-sm text-gray-600 mb-3 sm:mb-4">
              所属組織数: {userProfile.organizationIds?.length || 0}
            </p>
            <button 
              onClick={() => router.push('/staff/profile')} 
              className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 active:bg-gray-800 transition text-sm sm:text-base"
            >
              設定
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
