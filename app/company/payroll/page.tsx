'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDoc, getDocs, orderBy, query, where, Timestamp, updateDoc, setDoc, onSnapshot } from 'firebase/firestore';
import JapaneseHolidays from 'japanese-holidays';
import { db } from '@/lib/firebase';
import { useToast, ToastProvider } from '@/components/Toast';

// 休憩期間の型
interface BreakPeriod {
  startAt: Timestamp;
  endAt?: Timestamp;
}

interface TimecardRow {
  id: string;
  userId: string;
  dateKey: string;
  date: Date;
  clockInAt?: Timestamp;
  breaks: BreakPeriod[]; // 複数休憩対応
  clockOutAt?: Timestamp;
  hourlyWage?: number;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
}

interface UserApplication {
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
}

interface UserInfo {
  name: string;
  seed?: string;
  bgColor?: string;
}

export default function PayrollPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const { showSuccessToast, showErrorToast, showConfirmToast } = useToast();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timecards, setTimecards] = useState<TimecardRow[]>([]);
  const [userInfoMap, setUserInfoMap] = useState<Record<string, UserInfo>>({});
  const [memberTransport, setMemberTransport] = useState<Record<string, number>>({});
  const [monthlyReports, setMonthlyReports] = useState<Record<string, any>>({});
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    clockInAt: string;
    clockOutAt: string;
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
    transportAllowancePerShift: number;
  } | null>(null);

  useEffect(() => {
    if (!userProfile) return;
    if (!userProfile.isManage) {
      router.push('/staff/dashboard');
      return;
    }
  }, [userProfile, router]);

  // タイムカードのリアルタイム購読
  useEffect(() => {
    if (!userProfile?.currentOrganizationId) return;
    setLoading(true);
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
      where('dateKey', '<', endKey),
      orderBy('dateKey', 'asc')
    );
    const unsub = onSnapshot(qy, async (snap) => {
      const infoCache = new Map<string, UserInfo>();
      const rows: TimecardRow[] = [];
      for (const d of snap.docs) {
        const data = d.data() as any;
        if (data.status !== 'pending') continue;
        // ユーザー情報取得
        let info = userInfoMap[data.userId];
        if (!info) {
          let name = data.userId;
          let seed: string | undefined;
          let bgColor: string | undefined;
          try {
            const u = await getDoc(doc(db, 'users', data.userId));
            if (u.exists()) {
              const udata = u.data() as any;
              if (udata.deleted) {
                name = `(退職済み) ${udata.displayName || data.userId}`;
              } else {
                name = udata.displayName || data.userId;
              }
              seed = udata.avatarSeed || name || data.userId;
              bgColor = udata.avatarBackgroundColor;
            }
          } catch {
            name = `(退職済み) ${data.userId}`;
          }
          info = { name, seed, bgColor };
        }
        infoCache.set(data.userId, info);
        const [year, month, day] = data.dateKey.split('-').map(Number);
        rows.push({
          id: d.id,
          userId: data.userId,
          dateKey: data.dateKey,
          date: new Date(year, month - 1, day),
          clockInAt: data.clockInAt,
          breaks: data.breaks || [], // 配列として取得
          clockOutAt: data.clockOutAt,
          hourlyWage: data.hourlyWage,
          status: data.status || 'approved',
        });
      }
      setTimecards(rows);
      setUserInfoMap(Object.fromEntries(Array.from(infoCache.entries())));
      setLoading(false);
    });
    return () => unsub();
  }, [userProfile?.currentOrganizationId, selectedMonth]);

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
              holidayIncludesWeekend: !!o.holidayIncludesWeekend,
              transportAllowanceEnabled: !!o.transportAllowanceEnabled,
              transportAllowancePerShift: Number(o.transportAllowancePerShift ?? 0),
            });
          }
        } catch (e) {
          console.error('[Payroll] Error loading org settings:', e);
        }

        // メンバー交通費
        try {
          const memSnap = await getDocs(collection(db, 'organizations', userProfile.currentOrganizationId, 'members'));
          const tMap: Record<string, number> = {};
          memSnap.docs.forEach((d) => {
            const data = d.data() as any;
            if (data.transportAllowance !== undefined) {
              tMap[d.id] = Number(data.transportAllowance);
            }
          });
          setMemberTransport(tMap);
        } catch (e) {
          console.error('[Payroll] Error loading member transport:', e);
        }

        // 月次レポート取得
        try {
          const y = selectedMonth.getFullYear();
          const m = selectedMonth.getMonth() + 1;
          const reportPrefix = `${userProfile.currentOrganizationId}_${y}-${String(m).padStart(2, '0')}`;
          const reportsSnap = await getDocs(
            query(
              collection(db, 'monthlyReports'),
              where('organizationId', '==', userProfile.currentOrganizationId),
              where('year', '==', y),
              where('month', '==', m)
            )
          );
          const reports: Record<string, any> = {};
          reportsSnap.docs.forEach((d) => {
            const data = d.data();
            reports[data.userId] = { id: d.id, ...data };
          });
          setMonthlyReports(reports);
        } catch (e) {
          console.error('[Payroll] Error loading monthly reports:', e);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userProfile?.currentOrganizationId, selectedMonth]);

  // ヘルパー関数
  const minutesBetweenTimestamps = (start?: Timestamp, end?: Timestamp) => {
    if (!start || !end) return 0;
    return Math.max(0, Math.floor((end.toMillis() - start.toMillis()) / 60000));
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

  // 深夜時間の計算
  const calcNightMinutes = (clockIn?: Timestamp, clockOut?: Timestamp, nightStart?: string, nightEnd?: string) => {
    if (!clockIn || !clockOut || !nightStart || !nightEnd) return 0;
    
    const [nsHour, nsMin] = nightStart.split(':').map(Number);
    const [neHour, neMin] = nightEnd.split(':').map(Number);
    
    let totalNight = 0;
    const startMs = clockIn.toMillis();
    const endMs = clockOut.toMillis();
    
    for (let ms = startMs; ms < endMs; ms += 60000) {
      const d = new Date(ms);
      const h = d.getHours();
      const m = d.getMinutes();
      const currentMin = h * 60 + m;
      const nsTotal = nsHour * 60 + nsMin;
      const neTotal = neHour * 60 + neMin;
      
      let isNight = false;
      if (nsTotal <= neTotal) {
        isNight = currentMin >= nsTotal && currentMin < neTotal;
      } else {
        isNight = currentMin >= nsTotal || currentMin < neTotal;
      }
      if (isNight) totalNight++;
    }
    return totalNight;
  };

  // タイムカード1件の内訳計算
  const calcBreakdown = (tc: TimecardRow) => {
    const hourly = tc.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
    
    const grossMin = minutesBetweenTimestamps(tc.clockInAt, tc.clockOutAt);
    const breakMin = calcTotalBreakMinutes(tc.breaks); // 配列から計算
    const totalMin = grossMin - breakMin;
    
    const base = hourly * (totalMin / 60);
    
    const nightMin = orgSettings?.nightPremiumEnabled
      ? calcNightMinutes(tc.clockInAt, tc.clockOutAt, orgSettings.nightStart, orgSettings.nightEnd)
      : 0;
    const night = orgSettings?.nightPremiumEnabled ? hourly * (nightMin / 60) * (orgSettings.nightPremiumRate ?? 0) : 0;
    
    const overtimeMin = orgSettings?.overtimePremiumEnabled
      ? Math.max(0, totalMin - (orgSettings.overtimeDailyThresholdMinutes ?? 480))
      : 0;
    const overtime = orgSettings?.overtimePremiumEnabled ? hourly * (overtimeMin / 60) * (orgSettings.overtimePremiumRate ?? 0) : 0;
    
    const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
    const isHoliday = (d: Date) => !!JapaneseHolidays.isHoliday(d);
    const isHol = !!orgSettings?.holidayPremiumEnabled && (
      (orgSettings?.holidayIncludesWeekend && isWeekend(tc.date)) || isHoliday(tc.date)
    );
    const holiday = isHol ? hourly * (totalMin / 60) * (orgSettings?.holidayPremiumRate ?? 0) : 0;
    
    const transport = orgSettings?.transportAllowanceEnabled
      ? (memberTransport[tc.userId] ?? orgSettings.transportAllowancePerShift ?? 0)
      : 0;
    
    const total = Math.round(base + night + overtime + holiday + transport);
    
    return { base, night, overtime, holiday, transport, total, totalMin, nightMin, overtimeMin, breakMin };
  };

  // アバターURL生成関数（company/membersと同じ形式）
  const getAvatarUrl = (seed: string, bgColor?: string) => {
    const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
    const params = bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear';
    return `${base}${params}&fontWeight=700&radius=50`;
  };

  // ユーザーごとに集計
  const applications = useMemo(() => {
    const map = new Map<string, UserApplication>();
    
    for (const tc of timecards) {
      const userId = tc.userId;
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
        });
      }
      
      const app = map.get(userId)!;
      app.timecards.push(tc);
      app.workDays++;
      
      const bd = calcBreakdown(tc);
      app.totalMinutes += bd.totalMin;
      app.breakMinutes += bd.breakMin;
      app.nightMinutes += bd.nightMin;
      app.overtimeMinutes += bd.overtimeMin;
      app.base += bd.base;
      app.night += bd.night;
      app.overtime += bd.overtime;
      app.holiday += bd.holiday;
      app.transport += bd.transport;
      app.total += bd.total;
    }
    
    return Array.from(map.values()).sort((a, b) => a.userName.localeCompare(b.userName));
  }, [timecards, orgSettings, memberTransport, userInfoMap]);

  // 承認処理
  const handleApprove = async (userId: string) => {
    const confirmed = await showConfirmToast('この申請を承認しますか？', {
      title: '申請承認',
      confirmText: '承認',
      cancelText: 'キャンセル',
    });
    if (confirmed) {
      await executeApprove(userId);
    }
  };

  const executeApprove = async (userId: string) => {
    try {
      const userTimecards = timecards.filter(tc => tc.userId === userId && tc.status === 'pending');
      const now = Timestamp.now();
      const updatedIds: string[] = [];
      for (const tc of userTimecards) {
        const updates: any = {
          status: 'approved',
          updatedAt: now,
        };
        // 退勤がない場合は現在時刻を設定
        if (tc.clockInAt && !tc.clockOutAt) {
          updates.clockOutAt = now;
        }
        // 休憩中（最後の休憩にendAtがない）の場合は終了時刻を設定
        if (tc.breaks.length > 0) {
          const lastBreak = tc.breaks[tc.breaks.length - 1];
          if (lastBreak && !lastBreak.endAt) {
            const updatedBreaks = tc.breaks.map((b, i) =>
              i === tc.breaks.length - 1 ? { ...b, endAt: updates.clockOutAt || now } : b
            );
            updates.breaks = updatedBreaks;
          }
        }
        await updateDoc(doc(db, 'timecards', tc.id), updates);
        updatedIds.push(tc.id);
      }
      await saveMonthlyReport(userId);
      setTimecards(prev => prev.map(tc => {
        if (!updatedIds.includes(tc.id)) return tc;
        const updates: any = { status: 'approved', updatedAt: now };
        if (!tc.clockOutAt) updates.clockOutAt = now;
        if (tc.breaks.length > 0) {
          const lastBreak = tc.breaks[tc.breaks.length - 1];
          if (lastBreak && !lastBreak.endAt) {
            updates.breaks = tc.breaks.map((b, i) =>
              i === tc.breaks.length - 1 ? { ...b, endAt: updates.clockOutAt || now } : b
            );
          }
        }
        return { ...tc, ...updates };
      }));
      showSuccessToast('承認が完了しました');
    } catch (e) {
      console.error('[Payroll] approve error', e);
      showErrorToast('承認に失敗しました');
    }
  };

  // 月次レポート保存
  const saveMonthlyReport = async (userId: string) => {
    if (!userProfile?.currentOrganizationId) return;
    
    const y = selectedMonth.getFullYear();
    const m = selectedMonth.getMonth() + 1;
    const reportId = `${userProfile.currentOrganizationId}_${y}-${String(m).padStart(2, '0')}_${userId}`;
    
    const userApp = applications.find((app: any) => app.userId === userId);
    if (!userApp) {
      console.error('[Payroll] User application not found for userId:', userId);
      return;
    }
    
    const existingReportSnap = await getDoc(doc(db, 'monthlyReports', reportId));
    const existingData = existingReportSnap.exists() ? existingReportSnap.data() : null;
    const version = existingData ? (existingData.version || 0) + 1 : 1;
    
    const reportData = {
      organizationId: userProfile.currentOrganizationId,
      userId,
      userName: userApp.userName,
      year: y,
      month: m,
      workDays: userApp.workDays,
      totalWorkMinutes: userApp.totalMinutes,
      totalBreakMinutes: userApp.breakMinutes,
      totalNightMinutes: userApp.nightMinutes,
      totalOvertimeMinutes: userApp.overtimeMinutes,
      baseWage: Math.round(userApp.base),
      nightPremium: Math.round(userApp.night),
      overtimePremium: Math.round(userApp.overtime),
      holidayPremium: Math.round(userApp.holiday),
      transportAllowance: Math.round(userApp.transport),
      totalAmount: userApp.total,
      timecardCount: userApp.timecards.length,
      status: 'confirmed',
      version,
      approvedAt: Timestamp.now(),
      approvedBy: userProfile.uid,
      createdAt: existingData?.createdAt || Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    
    await setDoc(doc(db, 'monthlyReports', reportId), reportData);
    setMonthlyReports(prev => ({ ...prev, [userId]: { id: reportId, ...reportData } }));
  };

  // 差し戻し
  const handleRevert = async (userId: string) => {
    const reason = window.prompt('差し戻し理由を入力してください（任意）');
    if (reason === null) return;
    
    try {
      const report = monthlyReports[userId];
      if (!report?.id) {
        showErrorToast('月次レポートが見つかりません');
        return;
      }
      const reportId = report.id;
      
      await updateDoc(doc(db, 'monthlyReports', reportId), {
        status: 'reverted',
        revertedAt: Timestamp.now(),
        revertedBy: userProfile?.uid,
        revertReason: reason || '',
        updatedAt: Timestamp.now(),
      });
      
      const userTimecards = timecards.filter(tc => tc.userId === userId && tc.status === 'approved');
      const now = Timestamp.now();
      const updatedIds: string[] = [];
      for (const tc of userTimecards) {
        await updateDoc(doc(db, 'timecards', tc.id), {
          status: 'pending',
          updatedAt: now,
        });
        updatedIds.push(tc.id);
      }
      setTimecards(prev => prev.map(tc => updatedIds.includes(tc.id) ? { ...tc, status: 'pending', updatedAt: now } : tc));
      showSuccessToast(`差し戻しが完了しました（${userTimecards.length}件のタイムカードを未承認に戻しました）`);
    } catch (e) {
      console.error('[Payroll] revert error', e);
      showErrorToast('差し戻しに失敗しました');
    }
  };

  // 編集開始
  const startEdit = (tc: TimecardRow) => {
    const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
    setEditingCardId(tc.id);
    setEditForm({
      clockInAt: fmt(tc.clockInAt),
      clockOutAt: fmt(tc.clockOutAt),
    });
  };

  // 編集保存
  const saveEdit = async () => {
    if (!editingCardId || !editForm) return;
    try {
      const timeToTimestamp = (dateKey: string, timeStr: string) => {
        if (!timeStr) return null;
        const [year, month, day] = dateKey.split('-').map(Number);
        const [hour, minute] = timeStr.split(':').map(Number);
        return Timestamp.fromDate(new Date(year, month - 1, day, hour, minute));
      };
      const tc = timecards.find(t => t.id === editingCardId);
      if (!tc) return;
      const updates: any = { updatedAt: Timestamp.now() };
      if (editForm.clockInAt) updates.clockInAt = timeToTimestamp(tc.dateKey, editForm.clockInAt);
      if (editForm.clockOutAt) updates.clockOutAt = timeToTimestamp(tc.dateKey, editForm.clockOutAt);
      await updateDoc(doc(db, 'timecards', editingCardId), updates);
      setTimecards(prev => prev.map(t => t.id === editingCardId ? { ...t, ...updates } : t));
      setEditingCardId(null);
      setEditForm(null);
      showSuccessToast('保存しました');
    } catch (e) {
      console.error('[Payroll] save error', e);
      showErrorToast('保存に失敗しました');
    }
  };

  // 編集キャンセル
  const cancelEdit = () => {
    setEditingCardId(null);
    setEditForm(null);
  };

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));

  const selectedApp = selectedUserId ? applications.find(a => a.userId === selectedUserId) : null;

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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* ヘッダー */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">給与管理</h1>
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">←</button>
              <span className="font-semibold">
                {selectedMonth.getFullYear()}年{selectedMonth.getMonth() + 1}月
              </span>
              <button onClick={nextMonth} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">→</button>
            </div>
          </div>
          <button
            onClick={() => router.push('/company/dashboard')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← ダッシュボード
          </button>
        </div>

        {/* 申請一覧 */}
        {applications.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            承認待ちの申請はありません
          </div>
        ) : (
          <div className="space-y-4">
            {applications.map((app) => {
              const report = monthlyReports[app.userId];
              const isConfirmed = report?.status === 'confirmed';
              
              return (
                <div key={app.userId} className="bg-white rounded-lg shadow overflow-hidden">
                  {/* ユーザーヘッダー */}
                  <div 
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                    onClick={() => setSelectedUserId(selectedUserId === app.userId ? null : app.userId)}
                  >
                    <div className="flex items-center gap-4">
                      <img src={app.avatarUrl} alt="" className="w-10 h-10 rounded-full" />
                      <div>
                        <div className="font-semibold">{app.userName}</div>
                        <div className="text-sm text-gray-500">
                          {app.workDays}日勤務 / {Math.floor(app.totalMinutes / 60)}時間{app.totalMinutes % 60}分
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-lg font-bold text-blue-600">¥{app.total.toLocaleString()}</div>
                        <div className="text-xs text-gray-500">
                          {isConfirmed ? (
                            <span className="text-green-600">承認済み</span>
                          ) : (
                            <span className="text-yellow-600">申請中</span>
                          )}
                        </div>
                      </div>
                      {!isConfirmed && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleApprove(app.userId); }}
                          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          承認
                        </button>
                      )}
                      {isConfirmed && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRevert(app.userId); }}
                          className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
                        >
                          差し戻し
                        </button>
                      )}
                      <span className="text-gray-400">{selectedUserId === app.userId ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* 詳細テーブル */}
                  {selectedUserId === app.userId && selectedApp && (
                    <div className="border-t">
                      <div className="p-4 bg-gray-50 grid grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">基本給:</span>
                          <span className="ml-2 font-semibold">¥{Math.round(app.base).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">深夜:</span>
                          <span className="ml-2 font-semibold">¥{Math.round(app.night).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">残業:</span>
                          <span className="ml-2 font-semibold">¥{Math.round(app.overtime).toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">休日:</span>
                          <span className="ml-2 font-semibold">¥{Math.round(app.holiday).toLocaleString()}</span>
                        </div>
                      </div>
          
                      <div className="p-6">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="p-2 border-b text-center">日付</th>
                              <th className="p-2 border-b text-center">出勤</th>
                              <th className="p-2 border-b text-center">退勤</th>
                              <th className="p-2 border-b text-center">休憩(分)</th>
                              <th className="p-2 border-b text-center">勤務(分)</th>
                              <th className="p-2 border-b text-center">深夜(分)</th>
                              <th className="p-2 border-b text-center">残業(分)</th>
                              <th className="p-2 border-b text-center">時給</th>
                              <th className="p-2 border-b text-center">交通費(円)</th>
                              <th className="p-2 border-b text-center">合計(円)</th>
                              <th className="p-2 border-b text-center">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedApp.timecards.map((tc) => {
                              const bd = calcBreakdown(tc);
                              const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                              const isEditing = editingCardId === tc.id;
                              
                              return (
                                <tr key={tc.id} className="hover:bg-gray-50">
                                  <td className="p-2 border-b text-center">{tc.dateKey}</td>
                                  <td className="p-2 border-b text-center">
                                    {isEditing ? (
                                      <input 
                                        type="time" 
                                        value={editForm?.clockInAt || ''} 
                                        onChange={(e) => setEditForm(prev => prev ? {...prev, clockInAt: e.target.value} : null)}
                                        className="px-2 py-1 border rounded text-sm w-24"
                                      />
                                    ) : fmt(tc.clockInAt)}
                                  </td>
                                  <td className="p-2 border-b text-center">
                                    {isEditing ? (
                                      <input 
                                        type="time" 
                                        value={editForm?.clockOutAt || ''} 
                                        onChange={(e) => setEditForm(prev => prev ? {...prev, clockOutAt: e.target.value} : null)}
                                        className="px-2 py-1 border rounded text-sm w-24"
                                      />
                                    ) : fmt(tc.clockOutAt)}
                                  </td>
                                  <td className="p-2 border-b text-center">{bd.breakMin}</td>
                                  <td className="p-2 border-b text-center">{bd.totalMin}</td>
                                  <td className="p-2 border-b text-center">{bd.nightMin}</td>
                                  <td className="p-2 border-b text-center">{bd.overtimeMin}</td>
                                  <td className="p-2 border-b text-center">¥{tc.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100}</td>
                                  <td className="p-2 border-b text-center">¥{Math.round(bd.transport).toLocaleString('ja-JP')}</td>
                                  <td className="p-2 border-b text-center font-semibold">¥{bd.total.toLocaleString('ja-JP')}</td>
                                  <td className="p-2 border-b text-center">
                                    {isEditing ? (
                                      <div className="flex gap-1 justify-center">
                                        <button
                                          onClick={saveEdit}
                                          className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                        >
                                          保存
                                        </button>
                                        <button
                                          onClick={cancelEdit}
                                          className="px-2 py-1 bg-gray-300 rounded text-xs hover:bg-gray-400"
                                        >
                                          取消
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => startEdit(tc)}
                                        className="px-2 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300"
                                      >
                                        編集
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}