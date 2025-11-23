'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDoc, getDocs, orderBy, query, where, Timestamp, updateDoc, setDoc } from 'firebase/firestore';
import JapaneseHolidays from 'japanese-holidays';
import { db } from '@/lib/firebase';
import ApproveTimecardModal from '@/components/modals/ApproveTimecardModal';
import toast from 'react-hot-toast';

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
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timecards, setTimecards] = useState<TimecardRow[]>([]);
  const [userInfoMap, setUserInfoMap] = useState<Record<string, UserInfo>>({});
  const [memberTransport, setMemberTransport] = useState<Record<string, number>>({});
  const [monthlyReports, setMonthlyReports] = useState<Record<string, any>>({}); // userId -> report data
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    clockInAt: string;
    clockOutAt: string;
    breakStartAt: string;
    breakEndAt: string;
  } | null>(null);
  
  // モーダル管理
  const [approveModal, setApproveModal] = useState<{ isOpen: boolean; userId: string }>({ isOpen: false, userId: '' });
  
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

        // 月範囲のタイムカードを取得（status=pendingのみ）
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
              // 削除されたユーザーの場合は「(退職済み) 名前」と表示
              if (data.deleted) {
                name = `(退職済み) ${data.displayName || userId}`;
              } else {
                name = data.displayName || userId;
              }
              seed = data.avatarSeed || name || userId;
              bgColor = data.avatarBackgroundColor;
            }
          } catch {
            // ユーザードキュメントが存在しない場合は削除済みとみなす
            name = `(退職済み) ${userId}`;
          }
          const info: UserInfo = { name, seed, bgColor };
          infoCache.set(userId, info);
          return info;
        };

        const rows: TimecardRow[] = [];
        for (const d of snap.docs) {
          const data = d.data() as any;
          // pending（申請済み）のみを表示
          if (data.status !== 'pending') continue;
          
          await getUserInfo(data.userId); // キャッシュに追加
          
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
            status: data.status || 'approved', // 古いデータでstatusがない場合は'approved'とみなす
          });
        }
        setTimecards(rows);
        // userInfoMapをセット
        setUserInfoMap(Object.fromEntries(Array.from(infoCache.entries()).map(([id, v]) => [id, v])));
        
        // 月次レポートの状態を取得（承認済みユーザーを確認）
        const reportMap: Record<string, any> = {};
        const uniqueUserIds = Array.from(new Set(rows.map(r => r.userId)));
        for (const userId of uniqueUserIds) {
          const reportId = `${userProfile.currentOrganizationId}_${y}-${String(m + 1).padStart(2, '0')}_${userId}`;
          try {
            const reportSnap = await getDoc(doc(db, 'monthlyReports', reportId));
            if (reportSnap.exists()) {
              reportMap[userId] = reportSnap.data();
            }
          } catch (e) {
            console.warn(`[Payroll] Failed to load report for user ${userId}`, e);
          }
        }
        setMonthlyReports(reportMap);
        
        setError(null);
      } catch (e: any) {
        console.error('[Payroll] load error', e);
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

  // タイムスタンプ間の分数計算
  const minutesBetweenTimestamps = (start?: Timestamp, end?: Timestamp) => {
    if (!start || !end) return 0;
    return Math.max(0, Math.floor((end.toMillis() - start.toMillis()) / 60000));
  };

  // 深夜時間の計算（タイムスタンプベース）
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
    const breakMin = minutesBetweenTimestamps(tc.breakStartAt, tc.breakEndAt);
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

  // ユーザー別申請集計
  const applications = useMemo(() => {
    const map = new Map<string, UserApplication>();
    
    for (const tc of timecards) {
      const userId = tc.userId;
      
      if (!map.has(userId)) {
        const info = userInfoMap[userId] || { name: userId };
        const seed = info.seed || info.name || userId;
        const bgColor = info.bgColor;
        const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}${bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear'}&radius=50&fontWeight=700`;
        
        map.set(userId, {
          userId,
          userName: info.name,
          avatarUrl,
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
    try {
      const userTimecards = timecards.filter(tc => tc.userId === userId && tc.status === 'pending');
      const now = Timestamp.now();
      
      for (const tc of userTimecards) {
        const updates: any = {
          status: 'approved',
          updatedAt: now,
        };
        
        // 未完了のタイムカードを強制終了
        // 出勤はあるが退勤がない場合 → 現在時刻で退勤
        if (tc.clockInAt && !tc.clockOutAt) {
          updates.clockOutAt = now;
        }
        
        // 休憩開始はあるが休憩終了がない場合 → 退勤時刻（または現在時刻）で休憩終了
        if (tc.breakStartAt && !tc.breakEndAt) {
          updates.breakEndAt = updates.clockOutAt || now;
        }
        
        await updateDoc(doc(db, 'timecards', tc.id), updates);
      }
      
      // monthlyReportsに保存/更新（承認後のデータを使用するため、ユーザー情報を渡す）
      await saveMonthlyReport(userId);
      
      toast.success('承認が完了しました');
      window.location.reload();
    } catch (e) {
      console.error('[Payroll] approve error', e);
      toast.error('承認に失敗しました');
    }
  };

  // 月次レポート保存
  const saveMonthlyReport = async (userId: string) => {
    if (!userProfile?.currentOrganizationId) return;
    
    const y = selectedMonth.getFullYear();
    const m = selectedMonth.getMonth() + 1;
    const reportId = `${userProfile.currentOrganizationId}_${y}-${String(m).padStart(2, '0')}_${userId}`;
    
    // ユーザー情報取得（承認前の計算結果を使用）
    const userApp = applications.find((app: any) => app.userId === userId);
    if (!userApp) {
      console.error('[Payroll] User application not found for userId:', userId);
      return;
    }
    
    // 承認済みタイムカードが0件でもレポートを作成（今回承認したものが含まれるはず）
    console.log('[Payroll] Saving monthly report for user:', userId, 'reportId:', reportId);
    
    // 既存のレポートを確認（バージョン管理のため）
    const existingReportSnap = await getDoc(doc(db, 'monthlyReports', reportId));
    const existingData = existingReportSnap.exists() ? existingReportSnap.data() : null;
    const currentVersion = existingData?.version || 0;
    const newVersion = currentVersion + 1;
    
    // レポートデータを作成
    try {
      const now = Timestamp.now();
      await setDoc(doc(db, 'monthlyReports', reportId), {
        organizationId: userProfile.currentOrganizationId,
        userId: userId,
        userName: userApp.userName,
        year: y,
        month: m,
        // 集計データ
        workDays: userApp.workDays,
        totalWorkMinutes: userApp.totalMinutes,
        totalBreakMinutes: userApp.breakMinutes,
        totalNightMinutes: userApp.nightMinutes,
        totalOvertimeMinutes: userApp.overtimeMinutes,
        baseWage: userApp.base,
        nightPremium: userApp.night,
        overtimePremium: userApp.overtime,
        holidayPremium: userApp.holiday,
        transportAllowance: userApp.transport,
        totalAmount: userApp.total,
        timecardCount: userApp.timecards.length,
        // レポート状態
        status: 'confirmed',
        version: newVersion,
        // 承認情報
        approvedAt: now,
        approvedBy: userProfile.uid,
        // タイムスタンプ
        createdAt: existingData?.createdAt || now,
        updatedAt: now,
      });
      console.log('[Payroll] Monthly report saved successfully, version:', newVersion);
    } catch (err) {
      console.error('[Payroll] Error saving monthly report:', err);
      throw err;
    }
  };

  // 却下処理
  const handleReject = async (userId: string) => {
    const reason = prompt('却下理由を入力してください（任意）', '');
    if (reason === null) return; // キャンセル時は何もしない
    try {
      const userTimecards = timecards.filter(tc => tc.userId === userId && tc.status === 'pending');
      for (const tc of userTimecards) {
        await updateDoc(doc(db, 'timecards', tc.id), {
          status: 'rejected',
          rejectReason: reason || '',
          updatedAt: Timestamp.now(),
        });
      }
      toast.success('却下が完了しました');
      window.location.reload();
    } catch (e) {
      console.error('[Payroll] reject error', e);
      toast.error('却下に失敗しました');
    }
  };

  // 月次レポート差し戻し処理
  const handleRevertReport = async (userId: string) => {
    if (!userProfile?.currentOrganizationId) return;
    
    const reason = prompt('差し戻し理由を入力してください（任意）', '');
    if (reason === null) return; // キャンセル時は何もしない
    
    const y = selectedMonth.getFullYear();
    const m = selectedMonth.getMonth() + 1;
    const reportId = `${userProfile.currentOrganizationId}_${y}-${String(m).padStart(2, '0')}_${userId}`;
    
    try {
      // 1. 月次レポートを差し戻し済みに更新
      await updateDoc(doc(db, 'monthlyReports', reportId), {
        status: 'reverted',
        revertedAt: Timestamp.now(),
        revertedBy: userProfile.uid,
        revertReason: reason || '',
        updatedAt: Timestamp.now(),
      });
      
      // 2. 該当月の全タイムカードを approved → pending に戻す
      const userTimecards = timecards.filter(
        tc => tc.userId === userId && tc.status === 'approved'
      );
      
      for (const tc of userTimecards) {
        await updateDoc(doc(db, 'timecards', tc.id), {
          status: 'pending',
          updatedAt: Timestamp.now(),
        });
      }
      
      toast.success(`差し戻しが完了しました（${userTimecards.length}件のタイムカードを未承認に戻しました）`);
      window.location.reload();
    } catch (e) {
      console.error('[Payroll] revert error', e);
      toast.error('差し戻しに失敗しました');
    }
  };

  // 編集開始
  const startEdit = (tc: TimecardRow) => {
    const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
    setEditingCardId(tc.id);
    setEditForm({
      clockInAt: fmt(tc.clockInAt),
      clockOutAt: fmt(tc.clockOutAt),
      breakStartAt: fmt(tc.breakStartAt),
      breakEndAt: fmt(tc.breakEndAt),
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
      if (editForm.breakStartAt) updates.breakStartAt = timeToTimestamp(tc.dateKey, editForm.breakStartAt);
      if (editForm.breakEndAt) updates.breakEndAt = timeToTimestamp(tc.dateKey, editForm.breakEndAt);

      await updateDoc(doc(db, 'timecards', editingCardId), updates);
      toast.success('更新しました');
      setEditingCardId(null);
      setEditForm(null);
      window.location.reload();
    } catch (e) {
      console.error('[Payroll] edit error', e);
      toast.error('更新に失敗しました');
    }
  };

  // 詳細表示
  const selectedApp = applications.find(a => a.userId === selectedUserId);

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">給与計算（勤怠申請）</h1>
          <button onClick={() => router.push('/company/dashboard')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
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
            <div className="font-semibold">{selectedMonth.getFullYear()}年 {selectedMonth.getMonth() + 1}月</div>
            <button onClick={nextMonth} className="px-2 py-1 border rounded">→</button>
          </div>
          <div className="ml-auto text-sm text-gray-600">
            申請中: {applications.length}件
          </div>
        </div>

        {/* 申請一覧 */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 border-b text-left">ユーザー</th>
                <th className="p-3 border-b text-center">勤務日数</th>
                <th className="p-3 border-b text-center">勤務時間</th>
                <th className="p-3 border-b text-center">休憩時間</th>
                <th className="p-3 border-b text-center">基本給(円)</th>
                <th className="p-3 border-b text-center">深夜(円)</th>
                <th className="p-3 border-b text-center">残業(円)</th>
                <th className="p-3 border-b text-center">休日(円)</th>
                <th className="p-3 border-b text-center">交通費(円)</th>
                <th className="p-3 border-b text-center">合計金額(円)</th>
                <th className="p-3 border-b text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-center" colSpan={11}>読み込み中...</td></tr>
              ) : applications.length === 0 ? (
                <tr><td className="p-4 text-center text-gray-500" colSpan={11}>申請中のタイムカードがありません</td></tr>
              ) : (
                applications.map((app) => (
                  <tr key={app.userId} className="hover:bg-gray-50">
                    <td className="p-3 border-b">
                      <div className="flex items-center gap-2">
                        <img src={app.avatarUrl} alt={app.userName} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                        <span className="font-medium">{app.userName}</span>
                      </div>
                    </td>
                    <td className="p-3 border-b text-center">{app.workDays}日</td>
                    <td className="p-3 border-b text-center">{(app.totalMinutes / 60).toFixed(1)}h</td>
                    <td className="p-3 border-b text-center">{app.breakMinutes}分</td>
                    <td className="p-3 border-b text-center">¥{Math.round(app.base).toLocaleString('ja-JP')}</td>
                    <td className="p-3 border-b text-center">¥{Math.round(app.night).toLocaleString('ja-JP')}</td>
                    <td className="p-3 border-b text-center">¥{Math.round(app.overtime).toLocaleString('ja-JP')}</td>
                    <td className="p-3 border-b text-center">¥{Math.round(app.holiday).toLocaleString('ja-JP')}</td>
                    <td className="p-3 border-b text-center">¥{Math.round(app.transport).toLocaleString('ja-JP')}</td>
                    <td className="p-3 border-b text-center font-semibold text-emerald-600">¥{Math.round(app.total).toLocaleString('ja-JP')}</td>
                    <td className="p-3 border-b text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => setSelectedUserId(app.userId)} 
                          className="px-3 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          詳細
                        </button>
                        {monthlyReports[app.userId]?.status === 'confirmed' ? (
                          <button 
                            onClick={() => handleRevertReport(app.userId)} 
                            className="px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700"
                            title="承認済みのレポートを差し戻します"
                          >
                            差し戻し
                          </button>
                        ) : (
                          <>
                            <button 
                              onClick={() => setApproveModal({ isOpen: true, userId: app.userId })} 
                              className="px-3 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                              承認
                            </button>
                            <button 
                              onClick={() => setApproveModal({ isOpen: true, userId: app.userId })} 
                              className="px-3 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700"
                            >
                              却下
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 詳細モーダル */}
      {selectedApp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedUserId(null)}>
          <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src={selectedApp.avatarUrl} alt={selectedApp.userName} className="w-10 h-10 rounded-full ring-1 ring-gray-200" />
                <div>
                  <h2 className="text-xl font-bold">{selectedApp.userName}の勤怠詳細</h2>
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
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 border-b text-center">日付</th>
                    <th className="p-2 border-b text-center">出勤</th>
                    <th className="p-2 border-b text-center">退勤</th>
                    <th className="p-2 border-b text-center">休憩開始</th>
                    <th className="p-2 border-b text-center">休憩終了</th>
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
                        <td className="p-2 border-b text-center">
                          {isEditing ? (
                            <input 
                              type="time" 
                              value={editForm?.breakStartAt || ''} 
                              onChange={(e) => setEditForm(prev => prev ? {...prev, breakStartAt: e.target.value} : null)}
                              className="px-2 py-1 border rounded text-sm w-24"
                            />
                          ) : fmt(tc.breakStartAt)}
                        </td>
                        <td className="p-2 border-b text-center">
                          {isEditing ? (
                            <input 
                              type="time" 
                              value={editForm?.breakEndAt || ''} 
                              onChange={(e) => setEditForm(prev => prev ? {...prev, breakEndAt: e.target.value} : null)}
                              className="px-2 py-1 border rounded text-sm w-24"
                            />
                          ) : fmt(tc.breakEndAt)}
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
                              <button onClick={saveEdit} className="px-2 py-1 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700">保存</button>
                              <button onClick={() => { setEditingCardId(null); setEditForm(null); }} className="px-2 py-1 text-xs rounded bg-gray-400 text-white hover:bg-gray-500">キャンセル</button>
                            </div>
                          ) : (
                            <button onClick={() => startEdit(tc)} className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">編集</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-semibold">
                    <td className="p-2 border-t text-center">合計</td>
                    <td className="p-2 border-t text-center" colSpan={4}></td>
                    <td className="p-2 border-t text-center">{selectedApp.breakMinutes}分</td>
                    <td className="p-2 border-t text-center">{selectedApp.totalMinutes}分</td>
                    <td className="p-2 border-t text-center">{selectedApp.nightMinutes}分</td>
                    <td className="p-2 border-t text-center">{selectedApp.overtimeMinutes}分</td>
                    <td className="p-2 border-t text-center"></td>
                    <td className="p-2 border-t text-center">¥{Math.round(selectedApp.transport).toLocaleString('ja-JP')}</td>
                    <td className="p-2 border-t text-center text-emerald-600">¥{Math.round(selectedApp.total).toLocaleString('ja-JP')}</td>
                    <td className="p-2 border-t text-center"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
      
      {/* モーダル */}
      <ApproveTimecardModal
        isOpen={approveModal.isOpen}
        onClose={() => setApproveModal({ isOpen: false, userId: '' })}
        onConfirm={() => handleApprove(approveModal.userId)}
      />
    </div>
  );
}
