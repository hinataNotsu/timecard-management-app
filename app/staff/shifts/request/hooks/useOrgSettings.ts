'use client';

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getWeekStart, getBiweeklyPeriodStart, DAY_NAMES } from '../utils/dateUtils';
import type { SubmissionCycle } from '../utils/types';

interface UseOrgSettingsProps {
  orgId: string | undefined;
}

export function useOrgSettings({ orgId }: UseOrgSettingsProps) {
  const [defaultHourlyWage, setDefaultHourlyWage] = useState<number>(1100);
  const [shiftSubmissionCycle, setShiftSubmissionCycle] = useState<SubmissionCycle>('monthly');
  const [weekStartDay, setWeekStartDay] = useState<number>(1);
  const [weeklyDeadlineDaysBefore, setWeeklyDeadlineDaysBefore] = useState<number>(3);
  const [monthlyDeadlineDay, setMonthlyDeadlineDay] = useState<number>(25);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    
    const loadSettings = async () => {
      try {
        const orgSnap = await getDoc(doc(db, 'organizations', orgId));
        const org = orgSnap.exists() ? (orgSnap.data() as any) : {};
        
        const hourly = org.defaultHourlyWage != null ? Number(org.defaultHourlyWage) : 1100;
        if (!Number.isNaN(hourly) && hourly > 0) setDefaultHourlyWage(hourly);
        
        setShiftSubmissionCycle(org.shiftSubmissionCycle ?? 'monthly');
        setWeekStartDay(org.weekStartDay ?? 1);
        setWeeklyDeadlineDaysBefore(org.weeklyDeadlineDaysBefore ?? 3);
        setMonthlyDeadlineDay(org.monthlyDeadlineDay ?? 25);
      } catch (e) {
        console.warn('[useOrgSettings] failed to load', e);
      } finally {
        setIsLoading(false);
      }
    };
    loadSettings();
  }, [orgId]);

  // 締め切り日を取得
  const getDeadlineFor = useCallback((targetDate: Date): Date | null => {
    if (shiftSubmissionCycle === 'monthly') {
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();
      return new Date(year, month - 1, monthlyDeadlineDay, 23, 59, 59);
    } else if (shiftSubmissionCycle === 'weekly') {
      const weekStart = getWeekStart(targetDate, weekStartDay);
      const deadline = new Date(weekStart);
      deadline.setDate(deadline.getDate() - weeklyDeadlineDaysBefore);
      deadline.setHours(23, 59, 59, 999);
      return deadline;
    } else {
      const periodStart = getBiweeklyPeriodStart(targetDate, weekStartDay);
      const deadline = new Date(periodStart);
      deadline.setDate(deadline.getDate() - weeklyDeadlineDaysBefore);
      deadline.setHours(23, 59, 59, 999);
      return deadline;
    }
  }, [shiftSubmissionCycle, monthlyDeadlineDay, weekStartDay, weeklyDeadlineDaysBefore]);

  // 提出可能かどうか
  const canSubmitForDate = useCallback((date: Date): boolean => {
    const deadline = getDeadlineFor(date);
    if (!deadline) return true;
    return new Date() <= deadline;
  }, [getDeadlineFor]);

  // 締め切りメッセージ
  const getDeadlineMessage = useCallback((baseDate: Date): string => {
    const deadline = getDeadlineFor(baseDate);
    if (!deadline) return '';
    
    const now = new Date();
    if (now > deadline) {
      if (shiftSubmissionCycle === 'biweekly') {
        const periodStart = getBiweeklyPeriodStart(baseDate, weekStartDay);
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + 13);
        return `提出期限切れ（2週間期間: ${periodStart.toLocaleDateString()}～${periodEnd.toLocaleDateString()}）`;
      }
      return '提出期限は終了しています';
    }
    
    const diffMs = deadline.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (shiftSubmissionCycle === 'monthly') {
      return `提出期限: 毎月${monthlyDeadlineDay}日まで（残り${diffDays}日${diffHours}時間）`;
    } else if (shiftSubmissionCycle === 'biweekly') {
      const periodStart = getBiweeklyPeriodStart(baseDate, weekStartDay);
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + 13);
      return `提出期限: 2週間期間(${periodStart.toLocaleDateString()}～${periodEnd.toLocaleDateString()})開始の${weeklyDeadlineDaysBefore}日前まで（残り${diffDays}日${diffHours}時間）`;
    } else {
      return `提出期限: 週開始(${DAY_NAMES[weekStartDay]})の${weeklyDeadlineDaysBefore}日前まで（残り${diffDays}日${diffHours}時間）`;
    }
  }, [getDeadlineFor, shiftSubmissionCycle, monthlyDeadlineDay, weekStartDay, weeklyDeadlineDaysBefore]);

  return {
    defaultHourlyWage,
    shiftSubmissionCycle,
    weekStartDay,
    weeklyDeadlineDaysBefore,
    monthlyDeadlineDay,
    isLoading,
    getDeadlineFor,
    canSubmitForDate,
    getDeadlineMessage,
  };
}