'use client';

import { useEffect, useState, useMemo } from 'react';
import { collection, doc, getDoc, getDocs, query, where, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/Toast';
import {
  TimecardRow,
  MonthlyReport,
  OrgSettings,
  GroupedTimecard,
  PayrollSummary,
  ChartDataItem,
  calcSummary,
  groupTimecardsByDate,
  generateChartData,
  getCompletedDraftCards,
  isBreakComplete,
  getMonthDateKeyRange,
  dateKeyToDate,
} from '@/lib/payroll';

export const usePayrollData = (selectedMonth: Date) => {
  const { userProfile } = useAuth();
  const { showSuccessToast, showErrorToast, showConfirmToast, showInfoToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timecards, setTimecards] = useState<TimecardRow[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);
  const [transportPerShift, setTransportPerShift] = useState<number>(0);
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReport | null>(null);

  // データ取得
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
          console.error('[usePayrollData] Error loading org settings:', e);
        }

        // メンバー個別の交通費取得
        try {
          const memRef = doc(db, 'organizations', userProfile.currentOrganizationId, 'members', userProfile.uid);
          const memSnap = await getDoc(memRef);
          if (memSnap.exists()) {
            const mdata = memSnap.data() as any;
            if (mdata.transportAllowancePerShift !== undefined) {
              setTransportPerShift(Number(mdata.transportAllowancePerShift));
            }
          }
        } catch (e) {
          console.error('[usePayrollData] Error loading member transport:', e);
        }

        // タイムカード取得
        const { startKey, endKey } = getMonthDateKeyRange(selectedMonth);

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
          rows.push({
            id: d.id,
            dateKey: data.dateKey,
            date: dateKeyToDate(data.dateKey),
            clockInAt: data.clockInAt,
            breaks: data.breaks || [],
            clockOutAt: data.clockOutAt,
            hourlyWage: data.hourlyWage,
            status: data.status || 'approved',
          });
        }

        rows.sort((a, b) => a.date.getTime() - b.date.getTime());
        setTimecards(rows);

        // 月次レポートの状態を取得
        try {
          const y = selectedMonth.getFullYear();
          const m = selectedMonth.getMonth() + 1;
          const reportId = `${userProfile.currentOrganizationId}_${y}-${String(m).padStart(2, '0')}_${userProfile.uid}`;
          const reportSnap = await getDoc(doc(db, 'monthlyReports', reportId));
          if (reportSnap.exists()) {
            setMonthlyReport(reportSnap.data() as MonthlyReport);
          } else {
            setMonthlyReport(null);
          }
        } catch (e) {
          console.warn('[usePayrollData] monthly report load failed', e);
          setMonthlyReport(null);
        }

        setError(null);
      } catch (e: any) {
        console.error('[usePayrollData] load error', e);
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

  // 計算済みデータ
  const summary: PayrollSummary = useMemo(() => {
    return calcSummary(timecards, orgSettings, transportPerShift);
  }, [timecards, orgSettings, transportPerShift]);

  const groupedTimecards: GroupedTimecard[] = useMemo(() => {
    return groupTimecardsByDate(timecards, orgSettings, transportPerShift);
  }, [timecards, orgSettings, transportPerShift]);

  const chartData: ChartDataItem[] = useMemo(() => {
    return generateChartData(groupedTimecards);
  }, [groupedTimecards]);

  const completedDraftCards = useMemo(() => {
    return getCompletedDraftCards(timecards);
  }, [timecards]);

  const canSubmit = completedDraftCards.length > 0;

  // 一括申請
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
      console.error('[usePayrollData] submit error', e);
      showErrorToast('申請に失敗しました');
    }
  };

  return {
    loading,
    error,
    timecards,
    orgSettings,
    transportPerShift,
    monthlyReport,
    summary,
    groupedTimecards,
    chartData,
    completedDraftCards,
    canSubmit,
    handleBulkSubmit,
    setLoading,
    setError,
  };
};