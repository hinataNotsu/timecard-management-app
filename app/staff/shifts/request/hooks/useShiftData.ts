'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, doc, query, where, getDocs, addDoc, updateDoc, deleteDoc, orderBy, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ShiftEntry, StatusFilter } from '../utils/types';

interface UseShiftDataProps {
  uid: string | undefined;
  orgId: string | undefined;
  defaultHourlyWage: number;
}

export function useShiftData({ uid, orgId, defaultHourlyWage }: UseShiftDataProps) {
  const [shifts, setShifts] = useState<ShiftEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // シフト読み込み
  const loadMonthShifts = useCallback(async (date: Date) => {
    if (!uid || !orgId) return;
    
    setIsLoading(true);
    try {
      const year = date.getFullYear();
      const month = date.getMonth();
      const monthStart = new Date(year, month, 1, 0, 0, 0);
      const nextMonthStart = new Date(year, month + 1, 1, 0, 0, 0);

      const q = query(
        collection(db, 'shifts'),
        where('uid', '==', uid),
        where('organizationId', '==', orgId),
        where('date', '>=', Timestamp.fromDate(monthStart)),
        where('date', '<', Timestamp.fromDate(nextMonthStart)),
        orderBy('date', 'asc')
      );
      const snap = await getDocs(q);

      const loaded: ShiftEntry[] = snap.docs.map((d) => {
        const data = d.data() as any;
        const dateTs: Timestamp = data.date;
        const dt = dateTs.toDate();
        const yyyy = dt.getFullYear();
        const mm = (dt.getMonth() + 1).toString().padStart(2, '0');
        const dd = dt.getDate().toString().padStart(2, '0');
        return {
          id: d.id,
          date: `${yyyy}-${mm}-${dd}`,
          startTime: data.startTime,
          endTime: data.endTime,
          note: data.note || '',
          persisted: true,
          status: data.status || 'pending',
        };
      });

      setShifts(loaded);
    } catch (e) {
      console.error('[useShiftData] load failed', e);
    } finally {
      setIsLoading(false);
    }
  }, [uid, orgId]);

  // シフト保存（ドラッグ用）
  const saveShiftDirect = useCallback(async (shift: { date: string; startTime: string; endTime: string }): Promise<boolean> => {
    if (!uid || !orgId) return false;

    // 重複チェック
    const dateShifts = shifts.filter(s => s.date === shift.date);
    const hasOverlap = dateShifts.some(s => !(shift.endTime <= s.startTime || shift.startTime >= s.endTime));
    if (hasOverlap) {
      alert('この時間帯は既にシフトが入っています');
      return false;
    }

    try {
      const [y, m, d] = shift.date.split('-').map(v => parseInt(v, 10));
      const dateTs = Timestamp.fromDate(new Date(y, m - 1, d, 0, 0, 0));

      const docRef = await addDoc(collection(db, 'shifts'), {
        uid,
        organizationId: orgId,
        date: dateTs,
        startTime: shift.startTime,
        endTime: shift.endTime,
        note: '',
        status: 'pending',
        hourlyWage: defaultHourlyWage,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setShifts(prev => [...prev, {
        id: docRef.id,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        note: '',
        persisted: true,
        status: 'pending',
      }]);
      return true;
    } catch (e) {
      console.error('[useShiftData] save failed', e);
      alert('シフトの保存に失敗しました');
      return false;
    }
  }, [uid, orgId, shifts, defaultHourlyWage]);

  // シフト追加（モーダル用）
  const addShift = useCallback(async (shift: ShiftEntry): Promise<boolean> => {
    if (!uid || !orgId) return false;

    // 重複チェック
    const dateShifts = shifts.filter(s => s.date === shift.date);
    const hasOverlap = dateShifts.some(s => !(shift.endTime <= s.startTime || shift.startTime >= s.endTime));
    if (hasOverlap) {
      alert('この時間帯は既にシフトが入っています');
      return false;
    }

    try {
      const [y, m, d] = shift.date.split('-').map(v => parseInt(v, 10));
      const dateTs = Timestamp.fromDate(new Date(y, m - 1, d, 0, 0, 0));

      const docRef = await addDoc(collection(db, 'shifts'), {
        uid,
        organizationId: orgId,
        date: dateTs,
        startTime: shift.startTime,
        endTime: shift.endTime,
        note: shift.note ?? '',
        status: 'pending',
        hourlyWage: defaultHourlyWage,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setShifts(prev => [...prev, { ...shift, id: docRef.id, persisted: true, status: 'pending' }]);
      return true;
    } catch (e) {
      console.error('[useShiftData] add failed', e);
      alert('シフトの追加に失敗しました');
      return false;
    }
  }, [uid, orgId, shifts, defaultHourlyWage]);

  // シフト更新
  const updateShift = useCallback(async (id: string, shift: ShiftEntry): Promise<boolean> => {
    const target = shifts.find(s => s.id === id);
    if (!target) return false;

    // 重複チェック
    const dateShifts = shifts.filter(s => s.date === shift.date && s.id !== id);
    const hasOverlap = dateShifts.some(s => !(shift.endTime <= s.startTime || shift.startTime >= s.endTime));
    if (hasOverlap) {
      alert('この時間帯は既にシフトが入っています');
      return false;
    }

    try {
      if (target.persisted) {
        if (target.status && target.status !== 'pending') {
          alert('このシフトは承認済みまたは却下済みのため編集できません');
          return false;
        }
        const [y, m, d] = shift.date.split('-').map(v => parseInt(v, 10));
        const dateTs = Timestamp.fromDate(new Date(y, m - 1, d, 0, 0, 0));
        await updateDoc(doc(db, 'shifts', id), {
          date: dateTs,
          startTime: shift.startTime,
          endTime: shift.endTime,
          note: shift.note ?? '',
          // 時間を変更した場合は元の希望時間も更新
          originalStartTime: shift.startTime,
          originalEndTime: shift.endTime,
        });
      }
      setShifts(prev => prev.map(s => s.id === id ? { ...s, ...shift } : s));
      return true;
    } catch (e) {
      console.error('[useShiftData] update failed', e);
      alert('更新に失敗しました');
      return false;
    }
  }, [shifts]);

  // シフト削除
  const deleteShift = useCallback(async (id: string): Promise<boolean> => {
    const target = shifts.find(s => s.id === id);
    if (!target) return false;

    try {
      if (target.persisted) {
        await deleteDoc(doc(db, 'shifts', id));
      }
      setShifts(prev => prev.filter(s => s.id !== id));
      return true;
    } catch (e) {
      console.error('[useShiftData] delete failed', e);
      alert('シフトの削除に失敗しました');
      return false;
    }
  }, [shifts]);

  // リサイズ更新
  const updateShiftTime = useCallback(async (id: string, startTime: string, endTime: string): Promise<boolean> => {
    try {
      await updateDoc(doc(db, 'shifts', id), { 
        startTime, 
        endTime,
        // ドラッグでの時間変更時も元の希望時間を更新
        originalStartTime: startTime,
        originalEndTime: endTime,
      });
      setShifts(prev => prev.map(s => s.id === id ? { ...s, startTime, endTime } : s));
      return true;
    } catch (e) {
      console.error('[useShiftData] resize failed', e);
      return false;
    }
  }, []);

  // 日付ごとのシフト取得
  const getShiftsForDate = useCallback((date: string): ShiftEntry[] => {
    return shifts.filter(s => s.date === date);
  }, [shifts]);

  // フィルター適用
  const matchesFilter = useCallback((s: ShiftEntry): boolean => {
    return statusFilter === 'all' || (s.status ?? 'pending') === statusFilter;
  }, [statusFilter]);

  return {
    shifts,
    isLoading,
    statusFilter,
    setStatusFilter,
    loadMonthShifts,
    saveShiftDirect,
    addShift,
    updateShift,
    deleteShift,
    updateShiftTime,
    getShiftsForDate,
    matchesFilter,
  };
}