'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, orderBy, query, where, Timestamp, updateDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/Toast';
import {
  TimecardRow,
  OrgSettings,
  UserApplication,
  UserInfo,
  calcBreakdown,
  aggregateByUser,
  getAvatarUrl,
  getMonthDateKeyRange,
  dateKeyToDate,
  timeToTimestamp,
} from '@/lib/payroll';

export const useCompanyPayroll = (selectedMonth: Date) => {
  const { userProfile } = useAuth();
  const { showSuccessToast, showErrorToast, showConfirmToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timecards, setTimecards] = useState<TimecardRow[]>([]);
  const [userInfoMap, setUserInfoMap] = useState<Record<string, UserInfo>>({});
  const [memberTransport, setMemberTransport] = useState<Record<string, number>>({});
  const [monthlyReports, setMonthlyReports] = useState<Record<string, any>>({});
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);

  // タイムカードのリアルタイム購読
  useEffect(() => {
    if (!userProfile?.currentOrganizationId) return;
    setLoading(true);

    const { startKey, endKey } = getMonthDateKeyRange(selectedMonth);

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

        rows.push({
          id: d.id,
          userId: data.userId,
          dateKey: data.dateKey,
          date: dateKeyToDate(data.dateKey),
          clockInAt: data.clockInAt,
          breaks: data.breaks || [],
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

  // 組織設定・メンバー交通費・月次レポート取得
  useEffect(() => {
    const load = async () => {
      if (!userProfile?.currentOrganizationId) return;

      try {
        // 組織設定
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

        // メンバー交通費
        const memSnap = await getDocs(collection(db, 'organizations', userProfile.currentOrganizationId, 'members'));
        const tMap: Record<string, number> = {};
        memSnap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.transportAllowancePerShift !== undefined) {
            tMap[d.id] = Number(data.transportAllowancePerShift);
          }
        });
        setMemberTransport(tMap);

        // 月次レポート取得
        const y = selectedMonth.getFullYear();
        const m = selectedMonth.getMonth() + 1;
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
        console.error('[useCompanyPayroll] Error loading data:', e);
        setError('データの読み込みに失敗しました');
      }
    };

    load();
  }, [userProfile?.currentOrganizationId, selectedMonth]);

  // ユーザーごとに集計
  const applications: UserApplication[] = useMemo(() => {
    return aggregateByUser(timecards, orgSettings, memberTransport, userInfoMap, getAvatarUrl);
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
    if (!userProfile?.currentOrganizationId) return;

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
        // 休憩中の場合は終了時刻を設定
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
      console.error('[useCompanyPayroll] approve error', e);
      showErrorToast('承認に失敗しました');
    }
  };

  // 月次レポート保存（追加承認の場合は全体を再計算）
  const saveMonthlyReport = async (userId: string) => {
    if (!userProfile?.currentOrganizationId) return;

    const y = selectedMonth.getFullYear();
    const m = selectedMonth.getMonth() + 1;
    const reportId = `${userProfile.currentOrganizationId}_${y}-${String(m).padStart(2, '0')}_${userId}`;

    const userApp = applications.find((app) => app.userId === userId);
    if (!userApp) {
      console.error('[useCompanyPayroll] User application not found for userId:', userId);
      return;
    }

    // 今回承認するカードのIDセット（重複防止用）
    const pendingIds = new Set(userApp.timecards.map(tc => tc.id));

    // その月の該当ユーザーの全approvedタイムカードを取得
    const { startKey, endKey } = getMonthDateKeyRange(selectedMonth);

    const approvedQuery = query(
      collection(db, 'timecards'),
      where('organizationId', '==', userProfile.currentOrganizationId),
      where('userId', '==', userId),
      where('dateKey', '>=', startKey),
      where('dateKey', '<', endKey),
      where('status', '==', 'approved')
    );

    const approvedSnap = await getDocs(approvedQuery);
    const approvedDates = new Set<string>();
    let totalWorkMinutes = 0;
    let totalBreakMinutes = 0;
    let totalNightMinutes = 0;
    let totalOvertimeMinutes = 0;
    let baseWage = 0;
    let nightPremium = 0;
    let overtimePremium = 0;
    let holidayPremium = 0;
    let timecardCount = 0;

    for (const d of approvedSnap.docs) {
      // 今回承認するカードは後で追加するのでスキップ（重複防止）
      if (pendingIds.has(d.id)) continue;

      const data = d.data() as any;
      approvedDates.add(data.dateKey);

      const tc: TimecardRow = {
        id: d.id,
        userId: data.userId,
        dateKey: data.dateKey,
        date: dateKeyToDate(data.dateKey),
        clockInAt: data.clockInAt,
        breaks: data.breaks || [],
        clockOutAt: data.clockOutAt,
        hourlyWage: data.hourlyWage,
        status: data.status,
      };

      const bd = calcBreakdown(tc, orgSettings);
      totalWorkMinutes += bd.totalMin;
      totalBreakMinutes += bd.breakMin;
      totalNightMinutes += bd.nightMin;
      totalOvertimeMinutes += bd.overtimeMin;
      baseWage += bd.base;
      nightPremium += bd.night;
      overtimePremium += bd.overtime;
      holidayPremium += bd.holiday;
      timecardCount++;
    }

    // 今回承認するpendingカードも追加
    for (const tc of userApp.timecards) {
      approvedDates.add(tc.dateKey);

      const bd = calcBreakdown(tc, orgSettings);
      totalWorkMinutes += bd.totalMin;
      totalBreakMinutes += bd.breakMin;
      totalNightMinutes += bd.nightMin;
      totalOvertimeMinutes += bd.overtimeMin;
      baseWage += bd.base;
      nightPremium += bd.night;
      overtimePremium += bd.overtime;
      holidayPremium += bd.holiday;
      timecardCount++;
    }

    // 出勤日数 = ユニークな日付の数
    const workDays = approvedDates.size;

    // 交通費 = 出勤日数 × 1日あたりの交通費
    const transportPerDay = orgSettings?.transportAllowanceEnabled
      ? (memberTransport[userId] ?? orgSettings.transportAllowancePerShift ?? 0)
      : 0;
    const transportAllowance = workDays * transportPerDay;

    // 合計金額
    const totalAmount = Math.round(baseWage + nightPremium + overtimePremium + holidayPremium + transportAllowance);

    const existingReportSnap = await getDoc(doc(db, 'monthlyReports', reportId));
    const existingData = existingReportSnap.exists() ? existingReportSnap.data() : null;
    const version = existingData ? (existingData.version || 0) + 1 : 1;

    const reportData = {
      organizationId: userProfile.currentOrganizationId,
      userId,
      userName: userApp.userName,
      year: y,
      month: m,
      workDays,
      totalWorkMinutes: Math.round(totalWorkMinutes),
      totalBreakMinutes: Math.round(totalBreakMinutes),
      totalNightMinutes: Math.round(totalNightMinutes),
      totalOvertimeMinutes: Math.round(totalOvertimeMinutes),
      baseWage: Math.round(baseWage),
      nightPremium: Math.round(nightPremium),
      overtimePremium: Math.round(overtimePremium),
      holidayPremium: Math.round(holidayPremium),
      transportAllowance: Math.round(transportAllowance),
      totalAmount,
      timecardCount,
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

  // タイムカード編集保存
  const handleSaveEdit = async (id: string, clockInAt: string, clockOutAt: string) => {
    const tc = timecards.find(t => t.id === id);
    if (!tc) return;

    try {
      const updates: any = { updatedAt: Timestamp.now() };
      if (clockInAt) updates.clockInAt = timeToTimestamp(tc.dateKey, clockInAt);
      if (clockOutAt) updates.clockOutAt = timeToTimestamp(tc.dateKey, clockOutAt);

      await updateDoc(doc(db, 'timecards', id), updates);
      setTimecards(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
      showSuccessToast('保存しました');
    } catch (e) {
      console.error('[useCompanyPayroll] save error', e);
      showErrorToast('保存に失敗しました');
    }
  };

  return {
    loading,
    error,
    applications,
    monthlyReports,
    orgSettings,
    memberTransport,
    handleApprove,
    handleSaveEdit,
  };
};