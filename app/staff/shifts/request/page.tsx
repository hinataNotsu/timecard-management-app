'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/Toast';

import { CalendarHeader } from './components/CalendarHeader';
import { MonthView } from './components/MonthView';
import { WeekView } from './components/WeekView';
import { DayView } from './components/DayView';
import { ShiftModal } from './components/ShiftModal';

import { useOrgSettings } from './hooks/useOrgSettings';
import { useShiftData } from './hooks/useShiftData';
import { useShiftDrag } from './hooks/useShiftDrag';

import { minToTime } from './utils/dateUtils';
import type { ViewMode, ShiftEntry } from './utils/types';

export default function ShiftSubmitPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const { showErrorToast, showConfirmToast, showSuccessToast } = useToast();

  // ビュー状態
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [targetMonth, setTargetMonth] = useState(new Date());

  // モーダル状態
  const [isAddingShift, setIsAddingShift] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newShift, setNewShift] = useState<ShiftEntry>({
    date: '',
    startTime: '09:00',
    endTime: '18:00',
    note: '',
  });

  // 組織設定フック
  const orgId = userProfile?.currentOrganizationId;
  const {
    defaultHourlyWage,
    canSubmitForDate,
    getDeadlineMessage,
  } = useOrgSettings({ orgId });

  // シフトデータフック
  const {
    shifts,
    statusFilter,
    setStatusFilter,
    loadMonthShifts,
    saveShiftDirect,
    addShift,
    updateShift,
    deleteShift,
    updateShiftTime,
    matchesFilter,
  } = useShiftData({
    uid: userProfile?.uid,
    orgId,
    defaultHourlyWage,
  });

  // モーダルを開く処理
  const handleOpenModal = useCallback((date: string, startMin: number) => {
    setNewShift({
      date,
      startTime: minToTime(startMin),
      endTime: minToTime(Math.min(startMin + 60, 24 * 60)),
      note: '',
    });
    setEditingId(null);
    setIsAddingShift(true);
  }, []);

  // ドラッグフック
  const {
    tempShift,
    handleMouseDown,
    handleTouchStart,
    startResize,
  } = useShiftDrag({
    viewMode,
    canSubmitForDate,
    saveShiftDirect,
    updateShiftTime,
    onOpenModal: handleOpenModal,
    loadMonthShifts,
    currentDate,
    targetMonth,
  });

  // 認証チェック
  useEffect(() => {
    if (!userProfile?.currentOrganizationId) {
      router.push('/staff/dashboard');
      return;
    }
    const belongs = Array.isArray(userProfile.organizationIds) &&
      userProfile.organizationIds.includes(userProfile.currentOrganizationId);
    if (!belongs) {
      router.push('/join-organization');
    }
  }, [userProfile, router]);

  // シフト読み込み
  useEffect(() => {
    loadMonthShifts(currentDate);
  }, [userProfile?.uid, userProfile?.currentOrganizationId, currentDate.getFullYear(), currentDate.getMonth()]);

  // ナビゲーション
  const handleNavigate = useCallback((direction: 'prev' | 'next' | 'today') => {
    const today = new Date();
    if (direction === 'today') {
      setCurrentDate(today);
      if (viewMode === 'month') setTargetMonth(today);
      return;
    }

    const delta = direction === 'prev' ? -1 : 1;
    if (viewMode === 'month') {
      const newMonth = new Date(targetMonth);
      newMonth.setMonth(newMonth.getMonth() + delta);
      setTargetMonth(newMonth);
      setCurrentDate(newMonth);
    } else if (viewMode === 'week') {
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() + delta * 7);
      setCurrentDate(newDate);
    } else {
      const newDate = new Date(currentDate);
      newDate.setDate(newDate.getDate() + delta);
      setCurrentDate(newDate);
    }
  }, [viewMode, currentDate, targetMonth]);

  // シフトクリック
  const handleShiftClick = useCallback((shift: ShiftEntry) => {
    if (!canSubmitForDate(new Date(shift.date))) return;
    if (shift.status === 'approved' || shift.status === 'rejected') {
      showErrorToast('このシフトは承認済みまたは却下済みのため編集できません');
      return;
    }
    setNewShift(shift);
    setEditingId(shift.id || null);
    setIsAddingShift(true);
  }, [canSubmitForDate, showErrorToast]);

  // 日付クリック（月ビュー用）
  const handleDateClick = useCallback((dateStr: string) => {
    setNewShift({
      date: dateStr,
      startTime: '09:00',
      endTime: '18:00',
      note: '',
    });
    setEditingId(null);
    setIsAddingShift(true);
  }, []);

  // モーダルを閉じる
  const handleCloseModal = useCallback(() => {
    setIsAddingShift(false);
    setEditingId(null);
    setNewShift({ date: '', startTime: '09:00', endTime: '18:00', note: '' });
  }, []);

  // 削除リクエスト
  const handleDeleteRequest = useCallback(async (id: string) => {
    const shift = shifts.find(s => s.id === id);
    if (!shift) return;
    if (shift.status === 'approved' || shift.status === 'rejected') {
      showErrorToast('このシフトは承認済みまたは却下済みのため削除できません');
      return;
    }
    if (!canSubmitForDate(new Date(shift.date))) {
      showErrorToast('この日のシフトは締切を過ぎているため削除できません');
      return;
    }
    
    const confirmed = await showConfirmToast('このシフトを削除しますか？', {
      confirmText: '削除',
      cancelText: 'キャンセル'
    });
    
    if (confirmed) {
      await deleteShift(id);
      showSuccessToast('シフトを削除しました');
    }
  }, [shifts, canSubmitForDate, showErrorToast, showConfirmToast, deleteShift]);

  // リサイズ開始
  const handleResizeStart = useCallback((id: string, edge: 'start' | 'end', originalStart: string, originalEnd: string, startY: number) => {
    const shift = shifts.find(s => s.id === id);
    if (shift && !canSubmitForDate(new Date(shift.date))) {
      showErrorToast('この日のシフトは締切を過ぎているため変更できません');
      return;
    }
    startResize(id, edge, originalStart, originalEnd, startY);
  }, [shifts, canSubmitForDate, startResize, showErrorToast]);

  const displayDateForLock = viewMode === 'month' ? targetMonth : currentDate;
  const isSubmissionLocked = !canSubmitForDate(displayDateForLock);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <CalendarHeader
          viewMode={viewMode}
          currentDate={currentDate}
          targetMonth={targetMonth}
          statusFilter={statusFilter}
          isSubmissionLocked={isSubmissionLocked}
          deadlineMessage={getDeadlineMessage(displayDateForLock)}
          onViewModeChange={setViewMode}
          onNavigate={handleNavigate}
          onStatusFilterChange={setStatusFilter}
          onBackClick={() => router.push('/staff/dashboard')}
        />

        {viewMode === 'month' && (
          <MonthView
            currentDate={targetMonth}
            shifts={shifts}
            canSubmitForDate={canSubmitForDate}
            matchesFilter={matchesFilter}
            onShiftClick={handleShiftClick}
            onDateClick={handleDateClick}
          />
        )}

        {viewMode === 'week' && (
          <WeekView
            currentDate={currentDate}
            shifts={shifts}
            tempShift={tempShift}
            canSubmitForDate={canSubmitForDate}
            matchesFilter={matchesFilter}
            onShiftClick={handleShiftClick}
            onCellMouseDown={handleMouseDown}
            onCellTouchStart={handleTouchStart}
            onResizeStart={handleResizeStart}
          />
        )}

        {viewMode === 'day' && (
          <DayView
            currentDate={currentDate}
            shifts={shifts}
            tempShift={tempShift}
            canSubmitForDate={canSubmitForDate}
            matchesFilter={matchesFilter}
            onShiftClick={handleShiftClick}
            onCellMouseDown={handleMouseDown}
            onCellTouchStart={handleTouchStart}
            onResizeStart={handleResizeStart}
          />
        )}

        {/* シフトモーダル */}
        <ShiftModal
          isOpen={isAddingShift}
          editingId={editingId}
          initialShift={newShift}
          onSave={addShift}
          onUpdate={updateShift}
          onDelete={handleDeleteRequest}
          onClose={handleCloseModal}
          canSubmitForDate={canSubmitForDate}
        />
      </div>
    </div>
  );
}