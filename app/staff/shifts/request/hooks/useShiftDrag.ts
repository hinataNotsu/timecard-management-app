'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { minToTime } from '../utils/dateUtils';
import type { DragStartInfo, TempShift, ResizingShift, ViewMode } from '../utils/types';

interface UseShiftDragProps {
  viewMode: ViewMode;
  canSubmitForDate: (date: Date) => boolean;
  saveShiftDirect: (shift: TempShift) => Promise<boolean>;
  updateShiftTime: (id: string, startTime: string, endTime: string) => Promise<boolean>;
  onOpenModal: (date: string, startMin: number) => void;
  loadMonthShifts: (date: Date) => Promise<void>;
  currentDate: Date;
  targetMonth: Date;
}

export function useShiftDrag({
  viewMode,
  canSubmitForDate,
  saveShiftDirect,
  updateShiftTime,
  onOpenModal,
  loadMonthShifts,
  currentDate,
  targetMonth,
}: UseShiftDragProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartInfo, setDragStartInfo] = useState<DragStartInfo | null>(null);
  const [tempShift, setTempShift] = useState<TempShift | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [isLongPressActive, setIsLongPressActive] = useState(false);
  const [resizingShift, setResizingShift] = useState<ResizingShift | null>(null);
  const [dragMode, setDragMode] = useState<'down' | 'up'>('down');
  const [prevDragMin, setPrevDragMin] = useState<{ startMin: number; endMin: number } | null>(null);
  const [dragAnchorMin, setDragAnchorMin] = useState<number | null>(null);

  // requestAnimationFrame用のref
  const rafRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef<TempShift | null>(null);

  // タッチ状態をrefで保持
  const touchStateRef = useRef({
    isDragging: false,
    isLongPressActive: false,
    dragStartInfo: null as DragStartInfo | null,
    tempShift: null as TempShift | null,
    resizingShift: null as ResizingShift | null,
    dragMode: 'down' as 'down' | 'up',
    prevDragMin: null as { startMin: number; endMin: number } | null,
    dragAnchorMin: null as number | null,
  });

  useEffect(() => {
    touchStateRef.current = {
      isDragging, isLongPressActive, dragStartInfo, tempShift,
      resizingShift, dragMode, prevDragMin, dragAnchorMin,
    };
  }, [isDragging, isLongPressActive, dragStartInfo, tempShift, resizingShift, dragMode, prevDragMin, dragAnchorMin]);

  // フレーム同期でtempShiftを更新
  const scheduleUpdate = useCallback((newShift: TempShift) => {
    pendingUpdateRef.current = newShift;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        if (pendingUpdateRef.current) {
          setTempShift(pendingUpdateRef.current);
          pendingUpdateRef.current = null;
        }
        rafRef.current = null;
      });
    }
  }, []);

  // マウスドラッグ処理
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartInfo) return;

      if (!isDragging) {
        const scrollDelta = window.scrollY - dragStartInfo.startScrollY;
        const deltaY = Math.abs(e.clientY - dragStartInfo.startY + scrollDelta);
        if (deltaY > 5) {
          setIsDragging(true);
          setDragMode('down');
          setDragAnchorMin(dragStartInfo.startMin);
          const initialEndMin = Math.min(dragStartInfo.startMin + 60, 24 * 60);
          setPrevDragMin({ startMin: dragStartInfo.startMin, endMin: initialEndMin });
          setTempShift({
            date: dragStartInfo.date,
            startTime: minToTime(dragStartInfo.startMin),
            endTime: minToTime(initialEndMin),
          });
        }
        return;
      }

      if (dragAnchorMin === null) return;

      // 自動スクロール
      if (e.clientY < 120) window.scrollBy(0, -15);
      else if (e.clientY > window.innerHeight - 120) window.scrollBy(0, 15);

      const scrollDelta = window.scrollY - dragStartInfo.startScrollY;
      const deltaY = e.clientY - dragStartInfo.startY + scrollDelta;
      const pixelPerHour = viewMode === 'week' ? 48 : 64;
      const deltaMin = Math.round((deltaY / pixelPerHour) * 60 / 15) * 15;

      let newStartMin: number, newEndMin: number;

      if (dragMode === 'down') {
        newStartMin = dragAnchorMin;
        const attemptedEndMin = dragStartInfo.startMin + deltaMin;
        newEndMin = Math.max(dragAnchorMin + 30, attemptedEndMin);
        newEndMin = Math.min(newEndMin, 24 * 60);
        if (attemptedEndMin < dragAnchorMin + 30) {
          setDragMode('up');
          setDragAnchorMin(newEndMin);
        }
      } else {
        newEndMin = dragAnchorMin;
        const attemptedStartMin = (dragAnchorMin - 30) + deltaMin;
        newStartMin = Math.min(attemptedStartMin, dragAnchorMin - 30);
        newStartMin = Math.max(0, newStartMin);
        if (newEndMin > 24 * 60) newEndMin = 24 * 60;
        newStartMin = Math.min(newStartMin, newEndMin - 30);
        if (attemptedStartMin > dragAnchorMin - 30) {
          setDragMode('down');
          setDragAnchorMin(newStartMin);
        }
      }

      setPrevDragMin({ startMin: newStartMin, endMin: newEndMin });
      // requestAnimationFrameで更新をスロットル
      scheduleUpdate({
        date: dragStartInfo.date,
        startTime: minToTime(newStartMin),
        endTime: minToTime(newEndMin),
      });
    };

    const handleMouseUp = async () => {
      if (isDragging && tempShift) {
        await saveShiftDirect(tempShift);
      } else if (!isDragging && dragStartInfo) {
        onOpenModal(dragStartInfo.date, dragStartInfo.startMin);
      }
      resetDragState();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStartInfo, tempShift, viewMode, dragMode, prevDragMin, dragAnchorMin]);

  // タッチドラッグ処理
  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      const state = touchStateRef.current;

      if (longPressTimer && !state.isLongPressActive) {
        clearTimeout(longPressTimer);
        setLongPressTimer(null);
        return;
      }

      if (state.isLongPressActive && !state.isDragging && state.dragStartInfo) {
        const touch = e.touches[0];
        const scrollDelta = window.scrollY - state.dragStartInfo.startScrollY;
        const deltaY = Math.abs(touch.clientY - state.dragStartInfo.startY + scrollDelta);
        if (deltaY > 5) {
          e.preventDefault();
          setIsDragging(true);
          setDragMode('down');
          setDragAnchorMin(state.dragStartInfo.startMin);
          const initialEndMin = Math.min(state.dragStartInfo.startMin + 60, 24 * 60);
          setPrevDragMin({ startMin: state.dragStartInfo.startMin, endMin: initialEndMin });
          setTempShift({
            date: state.dragStartInfo.date,
            startTime: minToTime(state.dragStartInfo.startMin),
            endTime: minToTime(initialEndMin),
          });
        }
        return;
      }

      if (state.isDragging || state.resizingShift) {
        e.preventDefault();
      }

      if (state.isLongPressActive && state.isDragging && state.dragStartInfo && state.dragAnchorMin !== null) {
        const touch = e.touches[0];
        const pixelPerHour = viewMode === 'week' ? 48 : 64;
        const scrollDelta = window.scrollY - state.dragStartInfo.startScrollY;
        const deltaY = touch.clientY - state.dragStartInfo.startY + scrollDelta;
        const deltaMin = Math.round((deltaY / pixelPerHour) * 60 / 15) * 15;

        // 自動スクロール
        if (touch.clientY < 120) window.scrollBy(0, -15);
        else if (touch.clientY > window.innerHeight - 120) window.scrollBy(0, 15);

        let newStartMin: number, newEndMin: number;

        if (state.dragMode === 'down') {
          newStartMin = state.dragAnchorMin;
          const attemptedEndMin = state.dragStartInfo.startMin + deltaMin;
          newEndMin = Math.max(state.dragAnchorMin + 30, attemptedEndMin);
          newEndMin = Math.min(newEndMin, 24 * 60);
          if (attemptedEndMin < state.dragAnchorMin + 30) {
            setDragMode('up');
            setDragAnchorMin(newEndMin);
          }
        } else {
          newEndMin = state.dragAnchorMin;
          const attemptedStartMin = (state.dragAnchorMin - 30) + deltaMin;
          newStartMin = Math.min(attemptedStartMin, state.dragAnchorMin - 30);
          newStartMin = Math.max(0, newStartMin);
          if (newEndMin > 24 * 60) newEndMin = 24 * 60;
          newStartMin = Math.min(newStartMin, newEndMin - 30);
          if (attemptedStartMin > state.dragAnchorMin - 30) {
            setDragMode('down');
            setDragAnchorMin(newStartMin);
          }
        }

        setPrevDragMin({ startMin: newStartMin, endMin: newEndMin });
        // requestAnimationFrameで更新をスロットル
        scheduleUpdate({
          date: state.dragStartInfo.date,
          startTime: minToTime(newStartMin),
          endTime: minToTime(newEndMin),
        });
      }
    };

    const handleTouchEnd = async () => {
      const state = touchStateRef.current;

      if (longPressTimer) {
        clearTimeout(longPressTimer);
        setLongPressTimer(null);
      }

      if (state.isLongPressActive && !state.isDragging && state.dragStartInfo) {
        onOpenModal(state.dragStartInfo.date, state.dragStartInfo.startMin);
      } else if (state.isLongPressActive && state.isDragging && state.tempShift) {
        await saveShiftDirect(state.tempShift);
      }

      resetDragState();
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [viewMode, longPressTimer]);

  // リサイズ処理
  useEffect(() => {
    if (!resizingShift) return;

    const timeToMin = (time: string): number => {
      const [h, m] = time.split(':').map(v => parseInt(v, 10));
      return h * 60 + m;
    };

    const handleResize = async (deltaY: number) => {
      const pixelPerHour = viewMode === 'week' ? 48 : 64;
      const deltaMin = Math.round((deltaY / pixelPerHour) * 60 / 15) * 15;
      const startMin = timeToMin(resizingShift.originalStart);
      const endMin = timeToMin(resizingShift.originalEnd);

      let newStartMin = startMin, newEndMin = endMin;

      if (resizingShift.edge === 'start') {
        newStartMin = Math.max(0, Math.min(startMin + deltaMin, endMin - 30));
      } else {
        newEndMin = Math.min(24 * 60, Math.max(endMin + deltaMin, startMin + 30));
      }

      await updateShiftTime(resizingShift.id, minToTime(newStartMin), minToTime(newEndMin));
      if (viewMode === 'month') {
        await loadMonthShifts(targetMonth);
      } else {
        await loadMonthShifts(currentDate);
      }
    };

    const handleMouseMove = async (e: MouseEvent) => {
      const deltaY = e.pageY - resizingShift.startY;
      await handleResize(deltaY);
    };

    const handleMouseUp = () => setResizingShift(null);

    const handleTouchMove = async (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const deltaY = touch.pageY - resizingShift.startY;
      await handleResize(deltaY);
    };

    const handleTouchEnd = () => setResizingShift(null);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [resizingShift, viewMode, currentDate, targetMonth]);

  const resetDragState = useCallback(() => {
    setIsLongPressActive(false);
    setIsDragging(false);
    setDragStartInfo(null);
    setTempShift(null);
    setDragMode('down');
    setPrevDragMin(null);
    setDragAnchorMin(null);
  }, []);

  // マウスダウンハンドラ
  const handleMouseDown = useCallback((dateStr: string, clientY: number, startMin: number) => {
    setDragStartInfo({ date: dateStr, startY: clientY, startMin, startScrollY: window.scrollY });
  }, []);

  // タッチスタートハンドラ
  const handleTouchStart = useCallback((dateStr: string, clientY: number, startMin: number) => {
    const timer = setTimeout(() => {
      setIsLongPressActive(true);
      setDragStartInfo({ date: dateStr, startY: clientY, startMin, startScrollY: window.scrollY });
    }, 400);
    setLongPressTimer(timer);
  }, []);

  // リサイズ開始
  const startResize = useCallback((id: string, edge: 'start' | 'end', originalStart: string, originalEnd: string, startY: number) => {
    setResizingShift({ id, edge, originalStart, originalEnd, startY });
  }, []);

  return {
    tempShift,
    resizingShift,
    handleMouseDown,
    handleTouchStart,
    startResize,
  };
}