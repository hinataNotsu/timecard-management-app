'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, serverTimestamp, query, where, getDocs, updateDoc, addDoc, deleteDoc, orderBy, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Timestamp } from 'firebase/firestore';
import JapaneseHolidays from 'japanese-holidays';

type ViewMode = 'day' | 'week' | 'month';

interface ShiftEntry {
  id?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  note?: string;
  persisted?: boolean;
  status?: string; // 'pending' | 'approved' | 'rejected'
}

export default function ShiftSubmitPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [targetMonth, setTargetMonth] = useState(new Date());
  const [shifts, setShifts] = useState<ShiftEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending' | 'rejected'>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isAddingShift, setIsAddingShift] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newShift, setNewShift] = useState<ShiftEntry>({
    date: '',
    startTime: '09:00',
    endTime: '18:00',
    note: '',
  });
  const [orgDefaultHourlyWage, setOrgDefaultHourlyWage] = useState<number>(1100);
  const [shiftSubmissionEnforced, setShiftSubmissionEnforced] = useState<boolean>(false);
  const [shiftSubmissionMinDaysBefore, setShiftSubmissionMinDaysBefore] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartInfo, setDragStartInfo] = useState<{ date: string; startY: number; startMin: number } | null>(null); // startYはpageY（スクロール含む絶対座標）
  const [tempShift, setTempShift] = useState<{ date: string; startTime: string; endTime: string } | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [isLongPressActive, setIsLongPressActive] = useState(false);
  const [resizingShift, setResizingShift] = useState<{ id: string; edge: 'start' | 'end'; originalStart: string; originalEnd: string; startY: number } | null>(null);



  // 提出期限チェック（組織設定: シフト日からX日前まで）
  const canSubmitForMonth = (targetDate: Date): boolean => {
    if (!shiftSubmissionEnforced) return true;
    const now = new Date();
    const deadline = new Date(targetDate);
    deadline.setDate(deadline.getDate() - shiftSubmissionMinDaysBefore);
    // その日の0:00締切
    deadline.setHours(0, 0, 0, 0);
    return now.getTime() <= deadline.getTime();
  };

  // 表示モードに応じて判定対象の日付を切り替え
  const displayDateForLock = viewMode === 'month' ? targetMonth : currentDate;
  const isSubmissionLocked = !canSubmitForMonth(displayDateForLock);

  // 日付単位の提出可否（週/日ビュー用）
  const canSubmitForDate = (date: Date): boolean => {
    return canSubmitForMonth(date);
  };

  // 提出期限までの残り時間を表示（基準となる日付を引数に取る）
  const getDeadlineMessageFor = (baseDate: Date): string => {
    if (!shiftSubmissionEnforced) return '提出締切は無効です（企業設定で有効化すると適用されます）';
    const now = new Date();
    const deadline = new Date(baseDate);
    deadline.setDate(deadline.getDate() - shiftSubmissionMinDaysBefore);
    deadline.setHours(0, 0, 0, 0);
    if (now.getTime() > deadline.getTime()) {
      return `この期間の提出期限（シフト日の${shiftSubmissionMinDaysBefore}日前 0:00）は過ぎています`;
    }
    const diffMs = deadline.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `提出期限（シフト日の${shiftSubmissionMinDaysBefore}日前 0:00）まで残り${diffDays}日${diffHours}時間`;
  };

  useEffect(() => {
    if (!userProfile?.currentOrganizationId) {
      router.push('/staff/dashboard');
      return;
    }
    // 所属チェック：選択中の組織が自分の所属に含まれていない場合は組織参加ページへ誘導
    const orgId = userProfile.currentOrganizationId;
    const belongs = Array.isArray(userProfile.organizationIds) && userProfile.organizationIds.includes(orgId);
    if (!belongs) {
      router.push('/join-organization');
    }
    // 組織設定の読込（デフォルト時給/提出締切）
    const loadOrgSettings = async () => {
      try {
        const orgSnap = await getDoc(doc(db, 'organizations', orgId));
        const org = orgSnap.exists() ? (orgSnap.data() as any) : {};
        const hourly = org.defaultHourlyWage != null ? Number(org.defaultHourlyWage) : 1100;
        if (!Number.isNaN(hourly) && hourly > 0) setOrgDefaultHourlyWage(hourly);
        setShiftSubmissionEnforced(!!org.shiftSubmissionEnforced);
        setShiftSubmissionMinDaysBefore(Number(org.shiftSubmissionMinDaysBefore ?? 0));
      } catch (e) {
        console.warn('[Shift Submit] failed to load org settings', e);
      }
    };
    loadOrgSettings();
  }, [userProfile, router]);

  // ドラッグで作成したシフトを直接保存
  const saveShiftDirect = async (shift: { date: string; startTime: string; endTime: string }) => {
    if (!userProfile?.uid || !userProfile?.currentOrganizationId) {
      alert('ユーザーまたは所属組織が特定できません');
      return;
    }

    const orgId = userProfile.currentOrganizationId;
    const belongs = Array.isArray(userProfile.organizationIds) && userProfile.organizationIds.includes(orgId);
    if (!belongs) {
      alert('選択中の企業に未所属のためシフトを登録できません。企業IDの参加を完了してください。');
      router.push('/join-organization');
      return;
    }

    // 締切チェック
    if (!canSubmitForDate(new Date(shift.date))) {
      alert('この日のシフトは締切を過ぎているため追加できません');
      return;
    }

    // 既存のシフトと重複チェック
    const dateShifts = getShiftsForDate(shift.date);
    const hasOverlap = dateShifts.some(s => {
      return !(shift.endTime <= s.startTime || shift.startTime >= s.endTime);
    });

    if (hasOverlap) {
      alert('この時間帯は既にシフトが入っています');
      return;
    }

    try {
      const usersRef = doc(db, 'users', userProfile.uid);
      const [y, m, d] = shift.date.split('-').map((v) => parseInt(v, 10));
      const dateTs = Timestamp.fromDate(new Date(y, m - 1, d, 0, 0, 0));

      const docRef = await addDoc(collection(db, 'shifts'), {
        organizationId: userProfile.currentOrganizationId,
        userRef: usersRef,
        createdTime: serverTimestamp(),
        date: dateTs,
        startTime: shift.startTime,
        endTime: shift.endTime,
        originalStartTime: shift.startTime,
        originalEndTime: shift.endTime,
        note: '',
        hourlyWage: orgDefaultHourlyWage,
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        rejectReason: null,
      });

      // ローカル状態に反映
      setShifts([...shifts, { ...shift, id: docRef.id, persisted: true, status: 'pending', note: '' }]);
    } catch (e) {
      console.error('[Shift Submit] ドラッグでのシフト作成失敗:', e);
      alert('シフトの追加に失敗しました');
    }
  };

  // ドラッグ中のマウス移動とドラッグ終了処理
  useEffect(() => {
    if (!isDragging) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartInfo) return;
      
      // pageYを使用してスクロールを考慮した絶対座標で計算
      const deltaY = e.pageY - dragStartInfo.startY;
      // 週表示: 48px/時間、日表示: 64px/時間
      const pixelPerHour = viewMode === 'week' ? 48 : 64;
      const deltaMin = Math.round((deltaY / pixelPerHour) * 60 / 15) * 15; // 15分単位
      const endMin = Math.max(dragStartInfo.startMin + 15, dragStartInfo.startMin + deltaMin);
      
      setTempShift({
        date: dragStartInfo.date,
        startTime: minToTime(dragStartInfo.startMin),
        endTime: minToTime(Math.min(endMin, 24 * 60))
      });
    };
    
    const handleMouseUp = async () => {
      if (tempShift) {
        // ドラッグ終了：直接シフトを作成
        await saveShiftDirect(tempShift);
      }
      setIsDragging(false);
      setDragStartInfo(null);
      setTempShift(null);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStartInfo, tempShift, viewMode]);

  // リサイズ処理
  useEffect(() => {
    if (!resizingShift) return;

    const timeToMin = (time: string): number => {
      const [h, m] = time.split(':').map(v => parseInt(v, 10));
      return h * 60 + m;
    };

    const minToTime = (min: number): string => {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const handleMouseMove = async (e: MouseEvent) => {
      if (!resizingShift) return;

      const deltaY = e.pageY - resizingShift.startY;
      const pixelPerHour = viewMode === 'week' ? 48 : 64;
      const deltaMin = Math.round((deltaY / pixelPerHour) * 60 / 15) * 15;

      const startMin = timeToMin(resizingShift.originalStart);
      const endMin = timeToMin(resizingShift.originalEnd);

      let newStartMin = startMin;
      let newEndMin = endMin;

      if (resizingShift.edge === 'start') {
        newStartMin = Math.max(0, Math.min(startMin + deltaMin, endMin - 15));
      } else {
        newEndMin = Math.min(24 * 60, Math.max(endMin + deltaMin, startMin + 15));
      }

      // リアルタイムでFirestoreを更新
      try {
        await updateDoc(doc(db, 'shifts', resizingShift.id), {
          startTime: minToTime(newStartMin),
          endTime: minToTime(newEndMin),
        });
        // 表示を更新
        if (viewMode === 'month') {
          await loadMonthShifts(targetMonth);
        } else {
          await loadMonthShifts(currentDate);
        }
      } catch (e) {
        console.error('リサイズ中の更新失敗:', e);
      }
    };

    const handleMouseUp = () => {
      setResizingShift(null);
    };

    const handleTouchMove = async (e: TouchEvent) => {
      if (!resizingShift) return;
      e.preventDefault(); // スクロール防止

      const touch = e.touches[0];
      const deltaY = touch.pageY - resizingShift.startY;
      const pixelPerHour = viewMode === 'week' ? 48 : 64;
      const deltaMin = Math.round((deltaY / pixelPerHour) * 60 / 15) * 15;

      const startMin = timeToMin(resizingShift.originalStart);
      const endMin = timeToMin(resizingShift.originalEnd);

      let newStartMin = startMin;
      let newEndMin = endMin;

      if (resizingShift.edge === 'start') {
        newStartMin = Math.max(0, Math.min(startMin + deltaMin, endMin - 15));
      } else {
        newEndMin = Math.min(24 * 60, Math.max(endMin + deltaMin, startMin + 15));
      }

      try {
        await updateDoc(doc(db, 'shifts', resizingShift.id), {
          startTime: minToTime(newStartMin),
          endTime: minToTime(newEndMin),
        });
        if (viewMode === 'month') {
          await loadMonthShifts(targetMonth);
        } else {
          await loadMonthShifts(currentDate);
        }
      } catch (e) {
        console.error('リサイズ中の更新失敗:', e);
      }
    };

    const handleTouchEnd = () => {
      setResizingShift(null);
    };

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
  }, [resizingShift, viewMode, targetMonth, currentDate]);

  // 表示月のシフトを読み込む関数
  const loadMonthShifts = async (baseDate: Date) => {
    if (!userProfile?.uid || !userProfile?.currentOrganizationId) return;

    const y = baseDate.getFullYear();
    const m = baseDate.getMonth();
    const monthStart = new Date(y, m, 1, 0, 0, 0, 0);
    const nextMonthStart = new Date(y, m + 1, 1, 0, 0, 0, 0);

    const usersRef = doc(db, 'users', userProfile.uid);

    // サーバー側で月範囲フィルタ（index前提）
    const q = query(
      collection(db, 'shifts'),
      where('organizationId', '==', userProfile.currentOrganizationId),
      where('userRef', '==', usersRef),
      where('date', '>=', Timestamp.fromDate(monthStart)),
      where('date', '<', Timestamp.fromDate(nextMonthStart)),
      orderBy('date', 'asc')
    );
    const snap = await getDocs(q);

    const loaded: ShiftEntry[] = snap.docs
      .map((d) => {
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
        } as ShiftEntry;
      })
      ;

    setShifts(loaded);
  };

  // 初期表示と月が変わったときに読み込み
  useEffect(() => {
    loadMonthShifts(currentDate);
  }, [userProfile?.uid, userProfile?.currentOrganizationId, currentDate.getFullYear(), currentDate.getMonth()]);

  // カレンダー表示用の日付配列を生成
  const getCalendarDays = (date: Date): Date[] => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay()); // 日曜日から開始

    const days: Date[] = [];
    const current = new Date(startDate);

    while (days.length < 42) { // 6週間分
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  // 週表示用の日付配列を生成
  const getWeekDays = (date: Date): Date[] => {
    const days: Date[] = [];
    const current = new Date(date);
    current.setDate(current.getDate() - current.getDay()); // 日曜日に移動

    for (let i = 0; i < 7; i++) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  // 時間軸の配列を生成（0-23時）
  const getHourLabels = (): string[] => {
    return Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);
  };

  // ステータスフィルター適用
  const matchesFilter = (s: ShiftEntry) => statusFilter === 'all' || (s.status ?? 'pending') === statusFilter;

  // ステータス別クラス（承認=緑／申請中=灰／却下=赤）
  const classesForStatus = (status: string | undefined, kind: 'month' | 'block') => {
    const st = status ?? 'pending';
    if (kind === 'month') {
      if (st === 'approved') return 'bg-green-100 text-green-800 hover:bg-green-200';
      if (st === 'rejected') return 'bg-red-100 text-red-800 hover:bg-red-200';
      return 'bg-gray-100 text-gray-800 hover:bg-gray-200'; // pending
    } else {
      if (st === 'approved') return 'bg-green-500 text-white';
      if (st === 'rejected') return 'bg-red-500 text-white';
      return 'bg-gray-500 text-white'; // pending
    }
  };

  // 分を時刻文字列に変換
  const minToTime = (min: number): string => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // 日付文字列をフォーマット
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 日付の比較
  const isSameDate = (date1: Date, date2: Date): boolean => {
    return formatDate(date1) === formatDate(date2);
  };

  // その日のシフトを取得
  const getShiftsForDate = (date: string): ShiftEntry[] => {
    return shifts.filter(shift => shift.date === date);
  };

  // シフト追加
  const handleAddShift = () => {
    if (!selectedDate || isSubmissionLocked) return;

    setNewShift({
      date: selectedDate,
      startTime: '09:00',
      endTime: '18:00',
      note: '',
    });
    setIsAddingShift(true);
  };

  // シフト保存（即座にFirestoreへ）
  const handleSaveShift = async () => {
    if (!userProfile?.uid || !userProfile?.currentOrganizationId) {
      alert('ユーザーまたは所属組織が特定できません');
      return;
    }

    // 追加の所属チェック（ルール前に早期リターン）
    const orgId = userProfile.currentOrganizationId;
    const belongs = Array.isArray(userProfile.organizationIds) && userProfile.organizationIds.includes(orgId);
    if (!belongs) {
      alert('選択中の企業に未所属のためシフトを登録できません。企業IDの参加を完了してください。');
      router.push('/join-organization');
      return;
    }

    if (!newShift.date || !newShift.startTime || !newShift.endTime) return;

    // 時間の妥当性チェック
    if (newShift.startTime >= newShift.endTime) {
      alert('終了時刻は開始時刻より後にしてください');
      return;
    }

    // 締切チェック
    if (!canSubmitForDate(new Date(newShift.date))) {
      alert('この日のシフトは締切を過ぎているため追加できません');
      return;
    }

    // 既存のシフトと重複チェック
    const dateShifts = getShiftsForDate(newShift.date);
    const hasOverlap = dateShifts.some(shift => {
      return !(newShift.endTime <= shift.startTime || newShift.startTime >= shift.endTime);
    });

    if (hasOverlap) {
      alert('この時間帯は既にシフトが入っています');
      return;
    }

    try {
      const usersRef = doc(db, 'users', userProfile.uid);
      const [y, m, d] = newShift.date.split('-').map((v) => parseInt(v, 10));
      const dateTs = Timestamp.fromDate(new Date(y, m - 1, d, 0, 0, 0));

      console.log('[Debug] Shift creation attempt:', {
        organizationId: userProfile.currentOrganizationId,
        userRefPath: usersRef.path,
        userId: userProfile.uid,
        date: dateTs,
        userOrganizationIds: userProfile.organizationIds,
        currentOrganizationId: userProfile.currentOrganizationId,
      });

      const docRef = await addDoc(collection(db, 'shifts'), {
        organizationId: userProfile.currentOrganizationId,
        userRef: usersRef,
        createdTime: serverTimestamp(),
        date: dateTs,
        startTime: newShift.startTime,
        endTime: newShift.endTime,
        originalStartTime: newShift.startTime, // 元の希望時間を保存
        originalEndTime: newShift.endTime, // 元の希望時間を保存
        note: newShift.note ?? '',
        hourlyWage: orgDefaultHourlyWage,
        status: 'pending',
        approvedBy: null,
        approvedAt: null,
        rejectReason: null,
      });

      console.log('[Debug] Shift created successfully:', docRef.id);

      // ローカル状態に反映
      setShifts([...shifts, { ...newShift, id: docRef.id, persisted: true, status: 'pending' }]);
      setIsAddingShift(false);
      setNewShift({
        date: '',
        startTime: '09:00',
        endTime: '18:00',
        note: '',
      });
    } catch (e) {
      console.error('[Debug] Shift creation failed:', e);
      alert('シフトの追加に失敗しました');
    }
  };

  // 既存シフトの更新
  const handleUpdateShift = async () => {
    if (!editingId) return;
    if (!newShift.date || !newShift.startTime || !newShift.endTime) return;

    if (newShift.startTime >= newShift.endTime) {
      alert('終了時刻は開始時刻より後にしてください');
      return;
    }

    const dateShifts = getShiftsForDate(newShift.date).filter((s) => s.id !== editingId);
    const hasOverlap = dateShifts.some((s) => !(newShift.endTime <= s.startTime || newShift.startTime >= s.endTime));
    if (hasOverlap) {
      alert('この時間帯は既にシフトが入っています');
      return;
    }

    if (!canSubmitForDate(new Date(newShift.date))) {
      alert('この日のシフトは締切を過ぎているため更新できません');
      return;
    }

    // Firestoreに保存済みなら更新
    const target = shifts.find((s) => s.id === editingId);
    try {
      if (target?.persisted) {
        // 承認済み・却下済みは編集不可
        if (target.status && target.status !== 'pending') {
          alert('このシフトは承認済みまたは却下済みのため編集できません');
          return;
        }
        const [y, m, d] = newShift.date.split('-').map((v) => parseInt(v, 10));
        const dateTs = Timestamp.fromDate(new Date(y, m - 1, d, 0, 0, 0));
        await updateDoc(doc(db, 'shifts', editingId), {
          date: dateTs,
          startTime: newShift.startTime,
          endTime: newShift.endTime,
          note: newShift.note ?? '',
        });
        // 成功時のみローカル反映
        setShifts((prev) => prev.map((s) => (s.id === editingId ? { ...s, ...newShift } : s)));
      } else {
        // 未保存（ローカルのみ）の場合はローカル更新
        setShifts((prev) => prev.map((s) => (s.id === editingId ? { ...s, ...newShift } : s)));
      }
      setIsAddingShift(false);
      setEditingId(null);
    } catch (e) {
      console.error(e);
      alert('更新に失敗しました');
      // Firestore失敗時はサーバー状態を優先し再読込
      await loadMonthShifts(currentDate);
    }
  };

  // シフト削除（即座にFirestoreから削除）
  const handleDeleteShift = async (shiftId: string) => {
    const shift = shifts.find((s) => s.id === shiftId);
    if (!shift) return;

    // 承認済み・却下済みのシフトは削除不可
    if (shift.status === 'approved' || shift.status === 'rejected') {
      alert('このシフトは承認済みまたは却下済みのため削除できません');
      return;
    }

    if (!canSubmitForDate(new Date(shift.date))) {
      alert('この日のシフトは締切を過ぎているため削除できません');
      return;
    }

    if (!confirm('このシフトを削除しますか？')) return;

    try {
      if (shift.persisted) {
        await deleteDoc(doc(db, 'shifts', shiftId));
      }
      setShifts(shifts.filter((s) => s.id !== shiftId));
      
      // モーダルを閉じる
      setIsAddingShift(false);
      setEditingId(null);
      setNewShift({
        date: '',
        startTime: '09:00',
        endTime: '18:00',
        note: '',
      });
    } catch (e) {
      console.error(e);
      alert('シフトの削除に失敗しました');
    }
  };

  // ナビゲーション
  const handlePrevious = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() - 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setCurrentDate(newDate);
    if (viewMode === 'month') {
      setTargetMonth(newDate);
    }
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + 1);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
    if (viewMode === 'month') {
      setTargetMonth(newDate);
    }
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentDate(today);
    if (viewMode === 'month') {
      setTargetMonth(today);
    }
  };

  // 月表示
  const renderMonthView = () => {
    const days = getCalendarDays(currentDate);
    const currentMonth = currentDate.getMonth();

    return (
      <div className="bg-white rounded-lg shadow">
        <div className="grid grid-cols-7 border-b border-gray-300 border-opacity-50">
          {['日', '月', '火', '水', '木', '金', '土'].map((day, index) => (
            <div
              key={day}
              className={`p-3 text-center font-semibold border-r border-gray-300 border-opacity-50 last:border-r-0 ${
                index === 0 ? 'text-red-600' : index === 6 ? 'text-blue-600' : ''
              }`}
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, index) => {
            const dateStr = formatDate(day);
            const dayShifts = getShiftsForDate(dateStr).filter(matchesFilter);
            const isCurrentMonth = day.getMonth() === currentMonth;
            const isToday = isSameDate(day, new Date());
            const holiday = JapaneseHolidays.isHoliday(day);
            const dayOfWeek = day.getDay();
            const isLockedDay = !canSubmitForDate(day);

            return (
              <div
                key={index}
                className={`min-h-24 p-2 border-r border-b border-gray-300 border-opacity-50 last:border-r-0 ${
                  !isCurrentMonth ? 'bg-gray-50' : ''
                } ${isToday ? 'bg-blue-50' : ''} ${isLockedDay ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100'}`}
                title={isLockedDay ? 'この日のシフトは締切を過ぎています（前月25日12時）' : ''}
                onClick={() => {
                  setSelectedDate(dateStr);
                  setNewShift({
                    date: dateStr,
                    startTime: '09:00',
                    endTime: '18:00',
                    note: '',
                  });
                  if (!isLockedDay) {
                    setIsAddingShift(true);
                  }
                }}
              >
                <div className={`text-sm ${!isCurrentMonth ? 'text-gray-400' : holiday || dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : 'text-gray-900'} ${isToday ? 'font-bold' : ''}`}>
                  {day.getDate()}
                </div>
                <div className="mt-1 space-y-1">
                  {dayShifts.map(shift => (
                    <button
                      key={shift.id}
                      className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${classesForStatus(shift.status, 'month')}`}
                      title={`${shift.startTime}-${shift.endTime}${shift.note ? ': ' + shift.note : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canSubmitForDate(new Date(shift.date))) return;
                        setEditingId(shift.id!);
                        setNewShift({
                          date: shift.date,
                          startTime: shift.startTime,
                          endTime: shift.endTime,
                          note: shift.note ?? '',
                        });
                        setIsAddingShift(true);
                      }}
                    >
                      {shift.startTime}-{shift.endTime}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 週表示
  const renderWeekView = () => {
    const days = getWeekDays(currentDate);
    const hours = getHourLabels();

    return (
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <div className="grid grid-cols-8 min-w-max">
          <div className="sticky left-0 bg-gray-50 border-r border-gray-300 border-opacity-50 z-10">
            <div className="h-12 border-b border-gray-300 border-opacity-50"></div>
            {hours.map(hour => (
              <div key={hour} className="h-12 px-2 pt-1 text-sm text-gray-600 border-b border-gray-300 border-opacity-50 flex items-start">
                {hour}
              </div>
            ))}
          </div>
          {days.map((day, dayIndex) => {
            const dateStr = formatDate(day);
            const dayShifts = getShiftsForDate(dateStr).filter(matchesFilter);
            const isToday = isSameDate(day, new Date());
            const dayOfWeek = day.getDay();
            const holiday = JapaneseHolidays.isHoliday(day);
            const isLockedDay = !canSubmitForDate(day);
            const holidayName = holiday ? JapaneseHolidays.getHolidaysOf(day.getFullYear(), day.getMonth() + 1, day.getDate())[0]?.name : null;

            return (
              <div key={dayIndex} className="border-r border-gray-300 border-opacity-50 last:border-r-0 min-w-32">
                <div className={`h-12 p-2 border-b border-gray-300 border-opacity-50 text-center ${isToday ? 'bg-blue-50 font-bold' : 'bg-gray-50'}`}>
                  <div className={`text-xs ${
                    holiday || dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : 'text-gray-600'
                  }`}>
                    {['日', '月', '火', '水', '木', '金', '土'][dayOfWeek]}
                  </div>
                  <div className={`text-sm ${
                    holiday || dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : ''
                  }`}>{day.getDate()}</div>
                </div>
                <div className="relative">
                  {hours.map((hour, hourIndex) => (
                    <div
                      key={hour}
                      className={`h-12 border-b border-gray-300 border-opacity-50 ${isLockedDay ? 'cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'}`}
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                      title={isLockedDay ? 'この日のシフトは締切を過ぎています（前月25日12時）' : ''}
                      onMouseDown={(e) => {
                        if (isLockedDay) return;
                        const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                        const offsetY = e.clientY - rect.top;
                        const minutes = Math.round((offsetY / (48 * 24)) * 24 * 60 / 15) * 15; // 15分単位
                        setIsDragging(true);
                        setDragStartInfo({ date: dateStr, startY: e.pageY, startMin: minutes }); // pageYを使用
                        setTempShift({ date: dateStr, startTime: minToTime(minutes), endTime: minToTime(minutes + 60) });
                      }}
                      onTouchStart={(e) => {
                        if (isLockedDay) return;
                        const touch = e.touches[0];
                        const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                        const offsetY = touch.clientY - rect.top;
                        const minutes = Math.round((offsetY / (48 * 24)) * 24 * 60 / 15) * 15;
                        
                        const timer = setTimeout(() => {
                          setIsLongPressActive(true);
                          setIsDragging(true);
                          setDragStartInfo({ date: dateStr, startY: touch.clientY, startMin: minutes });
                          setTempShift({ date: dateStr, startTime: minToTime(minutes), endTime: minToTime(minutes + 60) });
                        }, 500);
                        setLongPressTimer(timer);
                      }}
                      onTouchMove={(e) => {
                        if (longPressTimer) {
                          clearTimeout(longPressTimer);
                          setLongPressTimer(null);
                        }
                        if (!isLongPressActive || !isDragging || !dragStartInfo) return;
                        const touch = e.touches[0];
                        const deltaY = touch.clientY - dragStartInfo.startY;
                        const deltaMin = Math.round((deltaY / 48) * 60 / 15) * 15;
                        const endMin = Math.max(dragStartInfo.startMin + 15, dragStartInfo.startMin + deltaMin);
                        setTempShift({
                          date: dragStartInfo.date,
                          startTime: minToTime(dragStartInfo.startMin),
                          endTime: minToTime(Math.min(endMin, 24 * 60 - 15)),
                        });
                      }}
                      onTouchEnd={() => {
                        if (longPressTimer) {
                          clearTimeout(longPressTimer);
                          setLongPressTimer(null);
                        }
                        if (isLongPressActive && tempShift) {
                          saveShiftDirect(tempShift);
                        }
                        setIsLongPressActive(false);
                        setIsDragging(false);
                        setDragStartInfo(null);
                        setTempShift(null);
                      }}
                      onClick={() => {
                        if (!isDragging) {
                          setSelectedDate(dateStr);
                          setNewShift({
                            date: dateStr,
                            startTime: hour,
                            endTime: `${(hourIndex + 1).toString().padStart(2, '0')}:00`,
                            note: '',
                          });
                          if (!isLockedDay) {
                            setIsAddingShift(true);
                          }
                        }
                      }}
                    ></div>
                  ))}
                  {dayShifts.map(shift => {
                    const startHour = parseInt(shift.startTime.split(':')[0]);
                    const startMin = parseInt(shift.startTime.split(':')[1]);
                    const endHour = parseInt(shift.endTime.split(':')[0]);
                    const endMin = parseInt(shift.endTime.split(':')[1]);
                    const top = (startHour + startMin / 60) * 48;
                    const height = ((endHour + endMin / 60) - (startHour + startMin / 60)) * 48;

                            return (
                              <div
                                key={shift.id}
                                className={`absolute left-1 right-1 ${classesForStatus(shift.status, 'block')} text-xs p-1 rounded-md overflow-visible ${!canSubmitForDate(new Date(shift.date)) ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'} group`}
                                style={{ top: `${top}px`, height: `${height}px` }}
                                onClick={(e) => {
                                  const target = e.target as HTMLElement;
                                  if (target.classList.contains('resize-handle')) return;
                                  e.stopPropagation();
                                  if (!canSubmitForDate(new Date(shift.date))) return;
                                  setEditingId(shift.id!);
                                  setNewShift({
                                    date: shift.date,
                                    startTime: shift.startTime,
                                    endTime: shift.endTime,
                                    note: shift.note ?? '',
                                  });
                                  setIsAddingShift(true);
                                }}
                              >
                                {canSubmitForDate(new Date(shift.date)) && (
                                  <>
                                    <div
                                      className="resize-handle absolute top-0 left-0 right-0 h-3 cursor-ns-resize hover:bg-black hover:bg-opacity-30 transition-opacity bg-gray-400 bg-opacity-30"
                                      style={{ WebkitTapHighlightColor: 'transparent' }}
                                      onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setResizingShift({ id: shift.id!, edge: 'start', originalStart: shift.startTime, originalEnd: shift.endTime, startY: e.pageY });
                                      }}
                                      onTouchStart={(e) => {
                                        e.stopPropagation();
                                        const touch = e.touches[0];
                                        setResizingShift({ id: shift.id!, edge: 'start', originalStart: shift.startTime, originalEnd: shift.endTime, startY: touch.pageY });
                                      }}
                                    />
                                    <div
                                      className="resize-handle absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize hover:bg-black hover:bg-opacity-30 transition-opacity bg-gray-400 bg-opacity-30"
                                      style={{ WebkitTapHighlightColor: 'transparent' }}
                                      onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setResizingShift({ id: shift.id!, edge: 'end', originalStart: shift.startTime, originalEnd: shift.endTime, startY: e.pageY });
                                      }}
                                      onTouchStart={(e) => {
                                        e.stopPropagation();
                                        const touch = e.touches[0];
                                        setResizingShift({ id: shift.id!, edge: 'end', originalStart: shift.startTime, originalEnd: shift.endTime, startY: touch.pageY });
                                      }}
                                    />
                                  </>
                                )}
                                <div className="font-semibold pointer-events-none py-1">{shift.startTime}-{shift.endTime}</div>
                                {shift.note && <div className="truncate pointer-events-none">{shift.note}</div>}
                              </div>
                            );
                  })}
                  {/* ドラッグ中の一時的なシフト表示 */}
                  {tempShift && tempShift.date === dateStr && (
                    <div
                      className="absolute left-1 right-1 bg-blue-300 bg-opacity-50 text-xs p-1 rounded-md overflow-hidden pointer-events-none border-2 border-blue-500 border-dashed"
                      style={{
                        top: `${(parseInt(tempShift.startTime.split(':')[0]) + parseInt(tempShift.startTime.split(':')[1]) / 60) * 48}px`,
                        height: `${((parseInt(tempShift.endTime.split(':')[0]) + parseInt(tempShift.endTime.split(':')[1]) / 60) - (parseInt(tempShift.startTime.split(':')[0]) + parseInt(tempShift.startTime.split(':')[1]) / 60)) * 48}px`
                      }}
                    >
                      <div className="font-semibold">{tempShift.startTime}-{tempShift.endTime}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 日表示
  const renderDayView = () => {
    const dateStr = formatDate(currentDate);
    const dayShifts = getShiftsForDate(dateStr).filter(matchesFilter);
    const hours = getHourLabels();
    const dayOfWeek = currentDate.getDay();
    const holiday = JapaneseHolidays.isHoliday(currentDate);
    const holidayName = holiday ? JapaneseHolidays.getHolidaysOf(currentDate.getFullYear(), currentDate.getMonth() + 1, currentDate.getDate())[0]?.name : null;
    const isLockedDay = !canSubmitForDate(currentDate);

    return (
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <div className="grid grid-cols-2 min-w-max">
          <div className="sticky left-0 bg-gray-50 border-r border-gray-300 border-opacity-50">
            <div className="h-12 border-b border-gray-300 border-opacity-50 p-2 text-center font-semibold">
              時間
            </div>
            {hours.map(hour => (
              <div key={hour} className="h-16 px-4 pt-1 text-sm text-gray-600 border-b border-gray-300 border-opacity-50 flex items-start">
                {hour}
              </div>
            ))}
          </div>
          <div className="relative border-r border-gray-300 border-opacity-50">
            <div className={`h-12 border-b border-gray-300 border-opacity-50 p-2 text-center font-semibold ${
              holiday || dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : ''
            }`}>
              {currentDate.getMonth() + 1}月{currentDate.getDate()}日
              (<span className={holiday || dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : ''}>{['日', '月', '火', '水', '木', '金', '土'][dayOfWeek]}</span>)
            </div>
            <div>
              {hours.map((hour, hourIndex) => (
                <div
                  key={hour}
                  className={`h-16 border-b border-gray-300 border-opacity-50 ${isLockedDay ? 'cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'}`}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                  title={isLockedDay ? 'この日のシフトは締切を過ぎています（前月25日12時）' : ''}
                  onMouseDown={(e) => {
                    if (isLockedDay) return;
                    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                    const offsetY = e.clientY - rect.top; // ヘッダー分は含まない（parentElement!はdivコンテナ）
                    const minutes = Math.round((offsetY / 64) * 60 / 15) * 15; // 64px = 1時間、15分単位
                    setIsDragging(true);
                    setDragStartInfo({ date: dateStr, startY: e.pageY, startMin: minutes }); // pageYを使用
                    setTempShift({ date: dateStr, startTime: minToTime(minutes), endTime: minToTime(minutes + 60) });
                  }}
                  onTouchStart={(e) => {
                    if (isLockedDay) return;
                    const touch = e.touches[0];
                    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                    const offsetY = touch.clientY - rect.top;
                    const minutes = Math.round((offsetY / 64) * 60 / 15) * 15;
                    
                    const timer = setTimeout(() => {
                      setIsLongPressActive(true);
                      setIsDragging(true);
                      setDragStartInfo({ date: dateStr, startY: touch.clientY, startMin: minutes });
                      setTempShift({ date: dateStr, startTime: minToTime(minutes), endTime: minToTime(minutes + 60) });
                    }, 500);
                    setLongPressTimer(timer);
                  }}
                  onTouchMove={(e) => {
                    if (longPressTimer) {
                      clearTimeout(longPressTimer);
                      setLongPressTimer(null);
                    }
                    if (!isLongPressActive || !isDragging || !dragStartInfo) return;
                    const touch = e.touches[0];
                    const deltaY = touch.clientY - dragStartInfo.startY;
                    const deltaMin = Math.round((deltaY / 64) * 60 / 15) * 15;
                    const endMin = Math.max(dragStartInfo.startMin + 15, dragStartInfo.startMin + deltaMin);
                    setTempShift({
                      date: dragStartInfo.date,
                      startTime: minToTime(dragStartInfo.startMin),
                      endTime: minToTime(Math.min(endMin, 24 * 60 - 15)),
                    });
                  }}
                  onTouchEnd={() => {
                    if (longPressTimer) {
                      clearTimeout(longPressTimer);
                      setLongPressTimer(null);
                    }
                    if (isLongPressActive && tempShift) {
                      saveShiftDirect(tempShift);
                    }
                    setIsLongPressActive(false);
                    setIsDragging(false);
                    setDragStartInfo(null);
                    setTempShift(null);
                  }}
                  onClick={() => {
                    if (!isDragging) {
                      setSelectedDate(dateStr);
                      setNewShift({
                        date: dateStr,
                        startTime: hour,
                        endTime: `${(hourIndex + 1).toString().padStart(2, '0')}:00`,
                        note: '',
                      });
                      if (!isLockedDay) {
                        setIsAddingShift(true);
                      }
                    }
                  }}
                ></div>
              ))}
              {dayShifts.map(shift => {
                const startHour = parseInt(shift.startTime.split(':')[0]);
                const startMin = parseInt(shift.startTime.split(':')[1]);
                const endHour = parseInt(shift.endTime.split(':')[0]);
                const endMin = parseInt(shift.endTime.split(':')[1]);
                const top = (startHour + startMin / 60) * 64;
                const height = ((endHour + endMin / 60) - (startHour + startMin / 60)) * 64;

                return (
                  <div
                    key={shift.id}
                    className={`absolute left-2 right-2 ${classesForStatus(shift.status, 'block')} p-2 rounded overflow-visible ${!canSubmitForDate(new Date(shift.date)) ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} group`}
                    title={!canSubmitForDate(new Date(shift.date)) ? 'このシフトは締切後のため編集できません' : ''}
                    style={{ top: `${top + 48}px`, height: `${height}px` }}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.classList.contains('resize-handle')) return;
                      e.stopPropagation();
                      if (!canSubmitForDate(new Date(shift.date))) return;
                      setEditingId(shift.id!);
                      setNewShift({
                        date: shift.date,
                        startTime: shift.startTime,
                        endTime: shift.endTime,
                        note: shift.note ?? '',
                      });
                      setIsAddingShift(true);
                    }}
                  >
                    {canSubmitForDate(new Date(shift.date)) && (
                      <>
                        <div
                          className="resize-handle absolute top-0 left-0 right-0 h-4 cursor-ns-resize hover:bg-black hover:bg-opacity-30 transition-opacity bg-gray-400 bg-opacity-30"
                          style={{ WebkitTapHighlightColor: 'transparent' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setResizingShift({ id: shift.id!, edge: 'start', originalStart: shift.startTime, originalEnd: shift.endTime, startY: e.pageY });
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            const touch = e.touches[0];
                            setResizingShift({ id: shift.id!, edge: 'start', originalStart: shift.startTime, originalEnd: shift.endTime, startY: touch.pageY });
                          }}
                        />
                        <div
                          className="resize-handle absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize hover:bg-black hover:bg-opacity-30 transition-opacity bg-gray-400 bg-opacity-30"
                          style={{ WebkitTapHighlightColor: 'transparent' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setResizingShift({ id: shift.id!, edge: 'end', originalStart: shift.startTime, originalEnd: shift.endTime, startY: e.pageY });
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            const touch = e.touches[0];
                            setResizingShift({ id: shift.id!, edge: 'end', originalStart: shift.startTime, originalEnd: shift.endTime, startY: touch.pageY });
                          }}
                        />
                      </>
                    )}
                    <div className="font-semibold pointer-events-none pt-2">{shift.startTime}-{shift.endTime}</div>
                    {shift.note && <div className="mt-1 pointer-events-none pb-2">{shift.note}</div>}
                  </div>
                );
              })}
              {/* ドラッグ中の一時的なシフト表示 */}
              {tempShift && tempShift.date === dateStr && (
                <div
                  className="absolute left-2 right-2 bg-blue-300 bg-opacity-50 p-2 rounded overflow-hidden pointer-events-none border-2 border-blue-500 border-dashed"
                  style={{
                    top: `${(parseInt(tempShift.startTime.split(':')[0]) + parseInt(tempShift.startTime.split(':')[1]) / 60) * 64 + 48}px`,
                    height: `${((parseInt(tempShift.endTime.split(':')[0]) + parseInt(tempShift.endTime.split(':')[1]) / 60) - (parseInt(tempShift.startTime.split(':')[0]) + parseInt(tempShift.startTime.split(':')[1]) / 60)) * 64}px`
                  }}
                >
                  <div className="font-semibold">{tempShift.startTime}-{tempShift.endTime}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* ヘッダー */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-gray-900">シフト提出</h1>
            <button
              onClick={() => router.push('/staff/dashboard')}
              className="px-4 py-2 text-gray-600 hover:text-gray-900"
            >
              ← ダッシュボードに戻る
            </button>
          </div>

          {/* 提出期限通知 */}
          {!isSubmissionLocked ? (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-800">📅 {getDeadlineMessageFor(displayDateForLock)}</p>
            </div>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-800">🔒 {getDeadlineMessageFor(displayDateForLock)}</p>
            </div>
          )}
        </div>

        {/* コントロールバー */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* ナビゲーション */}
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevious}
                className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                ←
              </button>
              <button
                onClick={handleToday}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                今日
              </button>
              <button
                onClick={handleNext}
                className="px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                →
              </button>
              <h2 className="ml-4 text-xl font-semibold">
                {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月
                {viewMode === 'day' && `${currentDate.getDate()}日`}
              </h2>
            </div>

            {/* ステータスフィルター */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-700">ステータス</label>
              <select
                className="px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
              >
                <option value="all">全て</option>
                <option value="approved">承認済み</option>
                <option value="pending">申請中</option>
                <option value="rejected">却下済み</option>
              </select>
            </div>

            {/* 表示モード切替 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('day')}
                className={`px-4 py-2 rounded-md ${
                  viewMode === 'day'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                日
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`px-4 py-2 rounded-md ${
                  viewMode === 'week'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                週
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`px-4 py-2 rounded-md ${
                  viewMode === 'month'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                月
              </button>
            </div>

            {/* シフト統計 */}
            <div className="text-sm text-gray-600">
              登録シフト: {shifts.length}件
            </div>
          </div>
        </div>

        {/* カレンダー表示 */}
        {viewMode === 'month' && renderMonthView()}
        {viewMode === 'week' && renderWeekView()}
        {viewMode === 'day' && renderDayView()}

        {/* シフト追加モーダル */}
        {isAddingShift && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-xl font-bold mb-4">{editingId ? 'シフトを編集' : 'シフトを追加'}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    日付
                  </label>
                  <input
                    type="date"
                    value={newShift.date}
                    onChange={(e) => setNewShift({ ...newShift, date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      開始時刻
                    </label>
                    <input
                      type="time"
                      value={newShift.startTime}
                      onChange={(e) => setNewShift({ ...newShift, startTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      終了時刻
                    </label>
                    <input
                      type="time"
                      value={newShift.endTime}
                      onChange={(e) => setNewShift({ ...newShift, endTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    備考（任意）
                  </label>
                  <textarea
                    value={newShift.note}
                    onChange={(e) => setNewShift({ ...newShift, note: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    rows={3}
                    placeholder="特記事項があれば入力してください"
                  />
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                {editingId ? (
                  <>
                    <button
                      onClick={handleUpdateShift}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                    >
                      更新
                    </button>
                    {(() => {
                      const shift = shifts.find(s => s.id === editingId);
                      const canDelete = shift && shift.status !== 'approved' && shift.status !== 'rejected';
                      return canDelete ? (
                        <button
                          onClick={() => handleDeleteShift(editingId)}
                          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                        >
                          削除
                        </button>
                      ) : null;
                    })()}
                  </>
                ) : (
                  <button
                    onClick={handleSaveShift}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                  >
                    追加
                  </button>
                )}
                <button
                  onClick={() => {
                    setIsAddingShift(false);
                    setEditingId(null);
                    setNewShift({
                      date: '',
                      startTime: '09:00',
                      endTime: '18:00',
                      note: '',
                    });
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
