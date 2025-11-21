'use client';

import { useEffect, useMemo, useState } from 'react';
import JapaneseHolidays from 'japanese-holidays';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDoc, getDocs, query, where, orderBy, updateDoc, addDoc, Timestamp as FirestoreTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Timestamp } from 'firebase/firestore';

interface ShiftLabel {
  id: string;
  name: string;
  color: string;
}

interface ShiftRow {
  id: string;
  userId: string;
  userName: string;
  avatarSeed?: string;
  avatarBgColor?: string;
  date: Date;
  startTime: string;
  endTime: string;
  originalStartTime?: string; // 提出時の元の開始時刻
  originalEndTime?: string; // 提出時の元の終了時刻
  note?: string;
  hourlyWage?: number;
  status?: 'pending' | 'approved' | 'rejected';
  approvedByName?: string | null;
  approvedAt?: Date | null;
  rejectReason?: string | null;
  labelId?: string | null; // シフトラベルID
}

export default function AdminShiftListPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'table' | 'month'>('table');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [dayShifts, setDayShifts] = useState<ShiftRow[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [orgSettings, setOrgSettings] = useState<{ defaultHourlyWage: number; nightPremiumEnabled: boolean; nightPremiumRate: number; nightStart: string; nightEnd: string } | null>(null);
  const [allOrgUsers, setAllOrgUsers] = useState<{ id: string; name: string; seed?: string; bgColor?: string }[]>([]);
  const [editedShifts, setEditedShifts] = useState<Map<string, { startTime: string; endTime: string }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [editModalTime, setEditModalTime] = useState<{ startTime: string; endTime: string }>({ startTime: '', endTime: '' });
  const [editingShift, setEditingShift] = useState<ShiftRow | null>(null);
  const [shiftLabels, setShiftLabels] = useState<ShiftLabel[]>([]);
  const [showLabelLegend, setShowLabelLegend] = useState(true);
  const [splitMode, setSplitMode] = useState(false);
  const [splitTime, setSplitTime] = useState<string>('');
  const [tempLabelId, setTempLabelId] = useState<string | null | undefined>(undefined);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelName, setEditingLabelName] = useState('');
  const [editingLabelColor, setEditingLabelColor] = useState('#8b5cf6');
  
  const availableColors = [
    { name: '紫', value: '#8b5cf6' },
    { name: 'ピンク', value: '#ec4899' },
    { name: '青', value: '#3b82f6' },
    { name: '水色', value: '#06b6d4' },
    { name: '緑', value: '#10b981' },
    { name: '黄色', value: '#eab308' },
    { name: 'オレンジ', value: '#f97316' },
    { name: '茶色', value: '#92400e' },
  ];

  useEffect(() => {
    if (!userProfile?.isManage) {
      router.push('/dashboard/part-time');
    }
  }, [userProfile, router]);

  useEffect(() => {
    const load = async () => {
      if (!userProfile?.currentOrganizationId) return;
      setLoading(true);
      try {
        // 組織設定の取得
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
            });
            // ラベルを読み込む
            if (o.shiftLabels && Array.isArray(o.shiftLabels)) {
              console.log('[Admin List] ラベルを読み込みました:', o.shiftLabels);
              setShiftLabels(o.shiftLabels);
            } else {
              console.log('[Admin List] 保存されたラベルがありません');
              setShiftLabels([]);
            }
          }
        } catch (e) {
          console.warn('[Admin List] failed to load org settings', e);
        }

        // 組織の全メンバーを取得（usersコレクションからorganizationIdsで取得）
        // 削除済み（deleted: true）のユーザーは除外
        try {
          const usersQuery = query(
            collection(db, 'users'),
            where('organizationIds', 'array-contains', userProfile.currentOrganizationId)
          );
          const usersSnap = await getDocs(usersQuery);
          
          const allUsers = usersSnap.docs
            .filter(userDoc => {
              const userData = userDoc.data() as any;
              // deleted: trueのユーザーは除外（過去のシフトには表示されるが、新規作成時の選択肢には出さない）
              return !userData.deleted;
            })
            .map(userDoc => {
              const userData = userDoc.data() as any;
              const userId = userDoc.id;
              const name = userData.displayName || userId;
              const seed = userData.avatarSeed || name || userId;
              const bgColor = userData.avatarBackgroundColor;
              
              return {
                id: userId,
                name,
                seed,
                bgColor,
              };
            });
          
          setAllOrgUsers(allUsers);
        } catch (e) {
          console.warn('[Admin List] failed to load org members', e);
        }
        // 月全件読み込みは負荷が大きいため、テーブル表示時のみ月ロードする
        if (viewMode === 'table') {
          // 月範囲でのサーバーサイド絞り込み
          const y = selectedMonth.getFullYear();
          const m = selectedMonth.getMonth();
          const monthStart = new Date(y, m, 1, 0, 0, 0, 0);
          const nextMonthStart = new Date(y, m + 1, 1, 0, 0, 0, 0);
          const q = query(
            collection(db, 'shifts'),
            where('organizationId', '==', userProfile.currentOrganizationId),
            where('date', '>=', Timestamp.fromDate(monthStart)),
            where('date', '<', Timestamp.fromDate(nextMonthStart)),
            orderBy('date', 'asc')
          );
          let snap;
          try {
            snap = await getDocs(q);
          } catch (err) {
            console.error('[Debug] shifts query failed:', {
              currentOrganizationId: userProfile.currentOrganizationId,
              monthStart,
              nextMonthStart,
              error: err,
            });
            throw err;
          }

          // userRef→ユーザー情報（displayName, avatarSeed）をキャッシュ取得
          const userCache = new Map<string, { name: string; seed: string; bgColor?: string }>();
          const getUserInfo = async (userId: string) => {
            if (userCache.has(userId)) return userCache.get(userId)!;
            let name = userId;
            let seed = userId;
            let bgColor: string | undefined;
            try {
              const u = await getDoc(doc(db, 'users', userId));
              if (u.exists()) {
                const data = u.data() as any;
                if (data.deleted) {
                  name = `(退職済み) ${data.displayName || userId}`;
                } else {
                  name = data.displayName || userId;
                }
                seed = data.avatarSeed || name || userId;
                bgColor = data.avatarBackgroundColor;
              }
            } catch (err) {
              console.warn('[Debug] users read failed for', userId, err);
              name = `(退職済み) ${userId}`;
            }
            const info = { name, seed, bgColor };
            userCache.set(userId, info);
            return info;
          };
          const getApproverName = async (approvedByRef: any) => {
            if (!approvedByRef?.path) return null;
            const approverId = approvedByRef.path.split('/').pop();
            if (!approverId) return null;
            const info = await getUserInfo(approverId);
            return info.name;
          };

          const rows: ShiftRow[] = [];
          for (const d of snap.docs) {
            const data = d.data() as any;
            const dateTs: Timestamp = data.date;
            const userRefPath: string = data.userRef?.path || '';
            const userId = userRefPath.split('/').pop();
            if (!userId) continue;
            const { name: userName, seed: avatarSeed, bgColor: avatarBgColor } = await getUserInfo(userId);
            
            // originalStartTime/originalEndTimeが存在しない場合、現在の値をFirestoreに保存
            if (!data.originalStartTime || !data.originalEndTime) {
              try {
                await updateDoc(d.ref, {
                  originalStartTime: data.startTime,
                  originalEndTime: data.endTime,
                });
              } catch (e) {
                console.warn('Failed to set original times for shift', d.id, e);
              }
            }
            
            rows.push({
              id: d.id,
              userId,
              userName,
              avatarSeed,
              avatarBgColor,
              date: dateTs.toDate(),
              startTime: data.startTime,
              endTime: data.endTime,
              originalStartTime: data.originalStartTime || data.startTime, // 元の希望時間を保存
              originalEndTime: data.originalEndTime || data.endTime, // 元の希望時間を保存
              note: data.note || '',
              labelId: data.labelId || null,
              hourlyWage: data.hourlyWage != null ? Number(data.hourlyWage) : undefined,
              status: (data.status as any) || 'pending',
              approvedByName: await getApproverName(data.approvedBy),
              approvedAt: data.approvedAt ? (data.approvedAt as Timestamp).toDate() : null,
              rejectReason: data.rejectReason || null,
            });
          }

          setShifts(rows);
        } else {
          // 月ビューでは月全件は読み込まず、日クリックで遅延取得する
          setShifts([]);
        }
      } catch (e) {
        console.error('[Debug] admin list load failed:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userProfile?.currentOrganizationId, selectedMonth]);

  // 月範囲はクエリで絞っているため前処理不要

  // 表モード用：シフトがあるユーザーのみ
  const usersWithShifts = useMemo(() => {
    const map = new Map<string, { name: string; seed?: string; bgColor?: string }>();
    shifts.forEach(s => {
      const cur = map.get(s.userId);
      if (!cur) map.set(s.userId, { name: s.userName, seed: s.avatarSeed, bgColor: s.avatarBgColor });
    });
    return Array.from(map.entries()).map(([id, v]) => ({ id, name: v.name, seed: v.seed, bgColor: v.bgColor }));
  }, [shifts]);

  // 月カレンダー用：全ユーザー（usersコレクションから取得した組織メンバー全員）
  const usersForCalendar = useMemo(() => {
    // 名前順にソート
    return [...allOrgUsers].sort((a, b) => a.name.localeCompare(b.name));
  }, [allOrgUsers]);

  const filtered = useMemo(() => {
    return shifts
      .filter(s => (selectedUserId === 'all' ? true : s.userId === selectedUserId))
      .sort((a, b) => a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime));
  }, [shifts, selectedUserId]);

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));

  const fmt = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  const fmtDateTime = (d: Date) => `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  const avatarUrl = (seed: string, bgColor?: string) => {
    const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
    const params = bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear';
    return `${base}${params}&fontWeight=700&radius=50`;
  };

  // 編集内容の一括保存
  const saveChanges = async () => {
    if (editedShifts.size === 0) return;
    
    // 希望時間外チェック
    const outOfRangeShifts: Array<{ shiftId: string; userName: string; original: string; modified: string }> = [];
    for (const [shiftId, times] of editedShifts.entries()) {
      const shift = dayShifts.find(s => s.id === shiftId);
      if (!shift) continue;
      
      const originalStart = shift.originalStartTime || shift.startTime;
      const originalEnd = shift.originalEndTime || shift.endTime;
      const newStart = times.startTime;
      const newEnd = times.endTime;
      
      // 希望時間外に延ばされているかチェック
      if (newStart < originalStart || newEnd > originalEnd) {
        outOfRangeShifts.push({
          shiftId,
          userName: shift.userName,
          original: `${originalStart}-${originalEnd}`,
          modified: `${newStart}-${newEnd}`
        });
      }
    }
    
    // 希望時間外のシフトがあれば確認
    if (outOfRangeShifts.length > 0) {
      const message = `以下のシフトが希望外の時間を含んでいます。保存してよろしいですか？\n\n${outOfRangeShifts.map(s => `${s.userName} (${s.original} → ${s.modified})`).join('\n')}`;
      if (!confirm(message)) {
        // キャンセルされた場合、希望時間外のシフトの編集を取り消す（元の時間に戻す）
        const newEditedShifts = new Map(editedShifts);
        for (const item of outOfRangeShifts) {
          // 編集を削除することで、元の時間（shift.startTime, shift.endTime）が表示される
          newEditedShifts.delete(item.shiftId);
        }
        setEditedShifts(newEditedShifts);
        return;
      }
    }
    
    setSaving(true);
    try {
      for (const [shiftId, times] of editedShifts.entries()) {
        const shiftRef = doc(db, 'shifts', shiftId);
        await updateDoc(shiftRef, {
          startTime: times.startTime,
          endTime: times.endTime,
        });
      }
      setEditedShifts(new Map());
      // 選択日のシフトを再読み込み
      if (selectedDay) {
        await fetchDayShifts(selectedDay);
      }
      alert('シフトを保存しました');
    } catch (error) {
      console.error('Save error:', error);
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 給与計算ヘルパー
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
    let night = 0;
    // 夜間が日跨ぎの場合 [ns,1440) ∪ [0,ne)
    const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
    if (ns <= ne) {
      night = overlap(s, e, ns, ne);
    } else {
      night = overlap(s, e, ns, 1440) + overlap(s, e, 0, ne);
    }
    return night;
  };
  const calcPay = (row: ShiftRow) => {
    const hourly = row.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100;
    const totalMin = minutesBetween(row.startTime, row.endTime);
    if (!orgSettings?.nightPremiumEnabled) return Math.round(hourly * (totalMin / 60));
    const nightMin = calcNightMinutes(row.startTime, row.endTime, orgSettings.nightStart, orgSettings.nightEnd);
    const dayMin = Math.max(0, totalMin - nightMin);
    const base = hourly * (totalMin / 60);
    const premium = hourly * (nightMin / 60) * orgSettings.nightPremiumRate;
    return Math.round(base + premium);
  };

  // 日クリック時に当日のシフトを遅延取得する
  const fetchDayShifts = async (day: Date) => {
    if (!userProfile?.currentOrganizationId) return;
    setDayLoading(true);
    try {
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
      const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const q = query(
        collection(db, 'shifts'),
        where('organizationId', '==', userProfile.currentOrganizationId),
        where('date', '>=', Timestamp.fromDate(dayStart)),
        where('date', '<', Timestamp.fromDate(nextDay)),
        orderBy('startTime', 'asc')
      );
      const snap = await getDocs(q);

      const rows: ShiftRow[] = [];
      for (const d of snap.docs) {
        const data = d.data() as any;
        const dateTs: Timestamp = data.date;
        const userRefPath: string = data.userRef?.path || '';
        const userId = userRefPath.split('/').pop();
        if (!userId) continue;
        // まず組織メンバーキャッシュから探す
        const cached = allOrgUsers.find(u => u.id === userId);
        let userName = cached?.name || userId;
        let avatarSeed = cached?.seed || userName;
        let avatarBgColor = cached?.bgColor;
        try {
          if (!cached) {
            const u = await getDoc(doc(db, 'users', userId));
            if (u.exists()) {
              const ud = u.data() as any;
              if (ud.deleted) userName = `(退職済み) ${ud.displayName || userId}`;
              else userName = ud.displayName || userId;
              avatarSeed = ud.avatarSeed || userName;
              avatarBgColor = ud.avatarBackgroundColor;
            }
          }
        } catch (e) {
          console.warn('failed to read user for day view', userId, e);
        }

        let approverName: string | null = null;
        try {
          if (data.approvedBy?.path) {
            const approverId = data.approvedBy.path.split('/').pop();
            if (approverId) {
              const au = await getDoc(doc(db, 'users', approverId));
              if (au.exists()) approverName = (au.data() as any).displayName || approverId;
            }
          }
        } catch (e) {
          console.warn('failed to read approver', e);
        }

        // originalStartTime/originalEndTimeが存在しない場合、現在の値をFirestoreに保存
        if (!data.originalStartTime || !data.originalEndTime) {
          try {
            await updateDoc(d.ref, {
              originalStartTime: data.startTime,
              originalEndTime: data.endTime,
            });
          } catch (e) {
            console.warn('Failed to set original times for shift', d.id, e);
          }
        }
        
        rows.push({
          id: d.id,
          userId,
          userName,
          avatarSeed,
          avatarBgColor,
          date: dateTs.toDate(),
          startTime: data.startTime,
          endTime: data.endTime,
          originalStartTime: data.originalStartTime || data.startTime, // 元の希望時間を保存
          originalEndTime: data.originalEndTime || data.endTime, // 元の希望時間を保存
          note: data.note || '',
          hourlyWage: data.hourlyWage != null ? Number(data.hourlyWage) : undefined,
          status: (data.status as any) || 'pending',
          approvedByName: approverName,
          approvedAt: data.approvedAt ? (data.approvedAt as Timestamp).toDate() : null,
          rejectReason: data.rejectReason || null,
          labelId: data.labelId || null,
        });
      }

      setDayShifts(rows);
    } catch (e) {
      console.error('failed to fetch day shifts', e);
      setDayShifts([]);
    } finally {
      setDayLoading(false);
    }
  };

  // 管理一覧では集計/CSVを表示しない方針のため、関連機能は削除

  // 月カレンダー用: 日付配列生成
  const getDaysInMonth = (date: Date): Date[] => {
    const y = date.getFullYear();
    const m = date.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    return Array.from({ length: lastDay }, (_, i) => new Date(y, m, i + 1));
  };

  const daysInMonth = useMemo(() => getDaysInMonth(selectedMonth), [selectedMonth]);

  // ユーザー×日付でのシフト取得ヘルパー
  const getShiftForUserDate = (userId: string, date: Date) => {
    const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;
    return shifts.find(s => s.userId === userId && 
      s.date.getFullYear() === date.getFullYear() &&
      s.date.getMonth() === date.getMonth() &&
      s.date.getDate() === date.getDate()
    );
  };

  const approve = async (id: string) => {
    if (!userProfile?.uid) return;
    try {
      const approverRef = doc(db, 'users', userProfile.uid);
      await updateDoc(doc(db, 'shifts', id), {
        status: 'approved',
        approvedBy: approverRef,
        approvedAt: Timestamp.now(),
        rejectReason: null,
      } as any);
      setShifts(prev => prev.map(s => s.id === id ? { ...s, status: 'approved', approvedByName: userProfile.displayName || s.approvedByName || '', approvedAt: new Date(), rejectReason: null } : s));
    } catch (e) {
      alert('承認に失敗しました');
      console.error(e);
    }
  };

  const reject = async (id: string) => {
    const reason = prompt('却下理由（任意）を入力してください', '');
    if (reason === null) return; // キャンセル時は何もしない
    try {
      await updateDoc(doc(db, 'shifts', id), {
        status: 'rejected',
        approvedBy: null,
        approvedAt: null,
        rejectReason: reason || '',
      } as any);
      setShifts(prev => prev.map(s => s.id === id ? { ...s, status: 'rejected', approvedByName: null, approvedAt: null, rejectReason: reason || '' } : s));
    } catch (e) {
      alert('却下に失敗しました');
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">シフト一覧（管理者）</h1>
          <button onClick={() => router.push('/dashboard/company')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="px-2 py-1 border rounded">←</button>
            <div className="font-semibold">{selectedMonth.getFullYear()}年 {selectedMonth.getMonth() + 1}月</div>
            <button onClick={nextMonth} className="px-2 py-1 border rounded">→</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setViewMode('table')} className={`px-3 py-1 rounded ${viewMode === 'table' ? 'bg-blue-500 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>表</button>
            <button onClick={() => setViewMode('month')} className={`px-3 py-1 rounded ${viewMode === 'month' ? 'bg-blue-500 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>月</button>
          </div>
          {viewMode === 'table' && (
            <div className="ml-auto flex items-center gap-2">
              <label className="text-sm text-gray-600">ユーザー</label>
              <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="px-2 py-1 border rounded">
                <option value="all">すべて</option>
                {usersWithShifts.map(u => (
                  <option value={u.id} key={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
          
        </div>

        {viewMode === 'table' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-center p-2 border-b">日付</th>
                <th className="text-center p-2 border-b">ユーザー</th>
                <th className="text-center p-2 border-b">時間帯</th>
                <th className="text-center p-2 border-b">備考</th>
                <th className="text-center p-2 border-b">ステータス</th>
                <th className="text-center p-2 border-b">承認者/日時</th>
                <th className="text-center p-2 border-b">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-center" colSpan={7}>読み込み中...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-center" colSpan={7}>該当データがありません</td></tr>
              ) : (
                filtered.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="p-2 border-b text-center">{fmt(row.date)}</td>
                    <td className="p-2 border-b text-center">
                      <div className="inline-flex items-center gap-2">
                        <img src={avatarUrl(row.avatarSeed || row.userName || row.userId, row.avatarBgColor)} alt={row.userName} className="w-6 h-6 rounded-full ring-1 ring-gray-200" />
                        <span>{row.userName}</span>
                      </div>
                    </td>
                    <td className="p-2 border-b text-center">{row.startTime} - {row.endTime}</td>
                    <td className="p-2 border-b text-center">{row.note}</td>
                    <td className="p-2 border-b text-center">
                      {row.status === 'approved' && <span className="inline-block px-2 py-0.5 rounded bg-green-100 text-green-700">承認</span>}
                      {row.status === 'pending' && <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-700">申請中</span>}
                      {row.status === 'rejected' && <span className="inline-block px-2 py-0.5 rounded bg-red-100 text-red-700">却下</span>}
                    </td>
                    <td className="p-2 border-b text-center text-xs text-gray-600">
                      {row.approvedByName ? `${row.approvedByName} / ${row.approvedAt ? fmtDateTime(row.approvedAt) : ''}` : '-'}
                    </td>
                    <td className="p-2 border-b text-center">
                      <div className="flex gap-2 justify-center">
                        <button disabled={row.status === 'approved'} onClick={() => approve(row.id)} className={`px-2 py-1 rounded border ${row.status === 'approved' ? 'opacity-40 cursor-not-allowed' : 'hover:bg-green-50 border-green-600 text-green-700'}`}>承認</button>
                        <button onClick={() => reject(row.id)} className="px-2 py-1 rounded border hover:bg-red-50 border-red-600 text-red-700">却下</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}

        {viewMode === 'month' && (
          <div className="bg-white rounded-lg shadow p-4">
            {/* 月カレンダー（週表示：日〜土） */}
            <div className="mb-4">
              <div className="grid grid-cols-7 border-b border-gray-300 border-opacity-50">
                {['日','月','火','水','木','金','土'].map((w, i) => (
                  <div key={w} className={`p-3 text-center font-semibold border-r border-gray-300 border-opacity-50 last:border-r-0 ${i===0?'text-red-600':i===6?'text-blue-600':''}`}>{w}</div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7">
                {(() => {
                  const y = selectedMonth.getFullYear();
                  const m = selectedMonth.getMonth();
                  const first = new Date(y, m, 1);
                  const start = new Date(first);
                  start.setDate(first.getDate() - first.getDay());
                  const cells: Date[] = [];
                  for (let i = 0; i < 42; i++) {
                    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
                    cells.push(d);
                  }
                  return cells.map(d => {
                    const inMonth = d.getMonth() === m;
                    const dow = d.getDay();
                    const holiday = JapaneseHolidays.isHoliday(d);
                    const dateColor = holiday || dow === 0 ? 'text-red-600' : dow === 6 ? 'text-blue-600' : inMonth ? 'text-gray-900' : 'text-gray-300';
                    const isSelected = selectedDay && selectedDay.getFullYear() === d.getFullYear() && selectedDay.getMonth() === d.getMonth() && selectedDay.getDate() === d.getDate();
                    return (
                      <button key={d.toISOString()} onClick={() => { setSelectedDay(d); fetchDayShifts(d); }} className={`relative min-h-24 p-2 border-r border-b border-gray-300 border-opacity-50 last:border-r-0 transition-colors ${!inMonth?'bg-gray-50':''} ${isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white hover:bg-gray-100'}`}>
                        <div className={`absolute top-1 left-1 text-sm ${!inMonth ? 'text-gray-400' : dateColor} ${isSelected ? 'font-bold' : ''}`}>{d.getDate()}</div>
                        <div className="text-[11px] text-gray-400" style={{ visibility: 'hidden' }}>{inMonth ? '' : ''}</div>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            {/* 選択日があれば時間軸表示（全ユーザー）- モーダル表示 */}
            {selectedDay && (
              <div className="fixed inset-0 bg-black/50 z-40 flex items-start justify-center pt-8 p-4" onClick={() => { setSelectedDay(null); setDayShifts([]); setEditedShifts(new Map()); }}>
                <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                  <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
                    <div className="font-semibold text-lg">{selectedDay.getFullYear()}年{selectedDay.getMonth() + 1}月{selectedDay.getDate()}日 のシフト（時間軸）</div>
                    <div className="flex items-center gap-2">
                      {editedShifts.size > 0 && (
                        <button
                          onClick={saveChanges}
                          disabled={saving}
                          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-semibold"
                        >
                          {saving ? '保存中...' : `変更を保存 (${editedShifts.size})`}
                        </button>
                      )}
                      <button 
                        onClick={() => { setSelectedDay(null); setDayShifts([]); setEditedShifts(new Map()); }} 
                        className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 text-gray-600 hover:text-gray-900 text-xl font-bold"
                        title="閉じる"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6">
                    {dayLoading ? (
                      <div className="text-center py-8">読み込み中...</div>
                    ) : (
                      <div className="overflow-x-auto">
                        {/* 凡例 */}
                        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                          <span className="font-semibold text-gray-700">色の意味:</span>
                          <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#2563eb' }}></div>
                            <span>申請中</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#dc2626' }}></div>
                            <span>却下</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded" style={{ backgroundColor: '#16a34a' }}></div>
                            <span>承認済み（未分類）</span>
                          </div>
                          {shiftLabels.map(label => (
                            <div key={label.id} className="flex items-center gap-1.5">
                              <div className="w-4 h-4 rounded" style={{ backgroundColor: label.color }}></div>
                              <span>{label.name}</span>
                            </div>
                          ))}
                          <button
                            onClick={() => setShowLabelManager(true)}
                            className="ml-2 px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-sm font-medium flex items-center gap-1"
                          >
                            <span className="text-lg leading-none">+</span>
                            <span>ラベル管理</span>
                          </button>
                        </div>
                        <div className="min-w-[900px]">
                      {/* 時間目盛り */}
                      <div className="flex items-center">
                        <div className="w-40" />
                        <div className="flex-1 relative">
                          <div className="absolute left-0 right-0 top-0 h-6">
                            <div className="flex h-6">
                              {Array.from({ length: 24 }).map((_, hh) => (
                                <div key={hh} className="flex-1 text-[11px] text-center border-l border-gray-100">{hh}:00</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ユーザー行（当日にシフト提出した人のみ表示） */}
                      <div className="mt-8 space-y-4">
                        {(() => {
                          // ユニークなユーザー一覧を dayShifts から作成
                          const map = new Map<string, { id: string; name: string; seed?: string; bgColor?: string }>();
                          for (const s of dayShifts) {
                            if (!map.has(s.userId)) {
                              const cached = allOrgUsers.find(u => u.id === s.userId);
                              map.set(s.userId, { id: s.userId, name: cached?.name || s.userName || s.userId, seed: cached?.seed || s.avatarSeed, bgColor: cached?.bgColor || s.avatarBgColor });
                            }
                          }
                          const usersToShow = Array.from(map.values());
                          if (usersToShow.length === 0) return <div className="text-sm text-gray-500">この日に提出されたシフトはありません</div>;
                          return usersToShow.map(user => {
                            const shiftsForUser = dayShifts.filter(s => s.userId === user.id);
                          return (
                            <div key={user.id} className="flex items-start">
                              <div className="w-40 pr-2">
                                <div className="flex items-center gap-2">
                                  <img src={avatarUrl(user.seed || user.name || user.id, user.bgColor)} alt={user.name} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                                  <div className="text-sm">{user.name}</div>
                                </div>
                              </div>
                              <div className="flex-1 relative h-12 bg-white border rounded">
                                {/* 背景の目盛り線 */}
                                <div className="absolute inset-0">
                                  <div className="h-full flex">
                                    {Array.from({ length: 24 }).map((_, i) => (
                                      <div key={i} className="flex-1 border-l border-gray-100" />
                                    ))}
                                  </div>
                                </div>

                                {/* シフトバー */}
                                <div className="relative h-full">
                                    {shiftsForUser.length === 0 && (
                                      <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">-</div>
                                    )}
                                    {shiftsForUser.map((s, idx) => {
                                      if (!s.startTime || !s.endTime) return null;
                                      
                                      const minToTime = (min: number) => {
                                        const h = Math.floor(min / 60);
                                        const m = min % 60;
                                        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                                      };
                                      const roundTo15 = (min: number) => Math.round(min / 15) * 15;
                                      
                                      const edited = editedShifts.get(s.id);
                                      const displayStart = edited?.startTime || s.startTime;
                                      const displayEnd = edited?.endTime || s.endTime;
                                      const startMin = timeToMin(displayStart);
                                      const endMin = timeToMin(displayEnd);
                                      
                                      if (isNaN(startMin) || isNaN(endMin)) return null;
                                      if (endMin <= startMin) return null;
                                      
                                      const leftPct = (startMin / 1440) * 100;
                                      const widthPct = ((endMin - startMin) / 1440) * 100;
                                      const minPct = (20 / Math.max(900, 900)) * 100;
                                      const finalWidthPct = Math.max(widthPct, minPct);
                                      
                                      const handleDragStart = (e: React.MouseEvent, edge: 'start' | 'end') => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const timeline = e.currentTarget.parentElement?.parentElement;
                                        if (!timeline) return;
                                        const rect = timeline.getBoundingClientRect();
                                        const totalWidth = rect.width;
                                        
                                        // 隣接するシフトを検出
                                        const findAdjacentShift = (time: string, adjacentType: 'before' | 'after') => {
                                          return shiftsForUser.find(shift => {
                                            if (shift.id === s.id) return false;
                                            const shiftEdited = editedShifts.get(shift.id);
                                            const shiftStart = shiftEdited?.startTime || shift.startTime;
                                            const shiftEnd = shiftEdited?.endTime || shift.endTime;
                                            return adjacentType === 'after' ? shiftStart === time : shiftEnd === time;
                                          });
                                        };
                                        
                                        const onMouseMove = (moveEvent: MouseEvent) => {
                                          const offsetX = moveEvent.clientX - rect.left;
                                          const pct = Math.max(0, Math.min(100, (offsetX / totalWidth) * 100));
                                          const minutes = roundTo15((pct / 100) * 24 * 60);
                                          const newTime = minToTime(minutes);
                                          
                                          if (edge === 'start') {
                                            if (minutes < endMin) {
                                              const newMap = new Map(editedShifts);
                                              newMap.set(s.id, { startTime: newTime, endTime: displayEnd });
                                              
                                              // 開始時刻を動かす場合、その時刻で終わる前のシフトも一緒に動かす
                                              const adjacentShift = findAdjacentShift(displayStart, 'before');
                                              if (adjacentShift) {
                                                const adjEdited = editedShifts.get(adjacentShift.id);
                                                const adjStart = adjEdited?.startTime || adjacentShift.startTime;
                                                newMap.set(adjacentShift.id, { startTime: adjStart, endTime: newTime });
                                              }
                                              
                                              setEditedShifts(newMap);
                                            }
                                          } else {
                                            if (minutes > startMin) {
                                              const newMap = new Map(editedShifts);
                                              newMap.set(s.id, { startTime: displayStart, endTime: newTime });
                                              
                                              // 終了時刻を動かす場合、その時刻で始まる次のシフトも一緒に動かす
                                              const adjacentShift = findAdjacentShift(displayEnd, 'after');
                                              if (adjacentShift) {
                                                const adjEdited = editedShifts.get(adjacentShift.id);
                                                const adjEnd = adjEdited?.endTime || adjacentShift.endTime;
                                                newMap.set(adjacentShift.id, { startTime: newTime, endTime: adjEnd });
                                              }
                                              
                                              setEditedShifts(newMap);
                                            }
                                          }
                                        };
                                        
                                        const onMouseUp = () => {
                                          document.removeEventListener('mousemove', onMouseMove);
                                          document.removeEventListener('mouseup', onMouseUp);
                                        };
                                        
                                        document.addEventListener('mousemove', onMouseMove);
                                        document.addEventListener('mouseup', onMouseUp);
                                      };
                                      
                                      const getShiftColor = () => {
                                        if (s.status === 'rejected') return '#dc2626'; // 却下は赤
                                        if (s.status === 'approved' && s.labelId) {
                                          const label = shiftLabels.find(l => l.id === s.labelId);
                                          if (label) return label.color;
                                        }
                                        if (s.status === 'approved') return '#16a34a'; // ラベルなし承認は緑
                                        return '#2563eb'; // 申請中は青
                                      };
                                      const bgColor = getShiftColor();
                                      
                                      const handleBarClick = (e: React.MouseEvent) => {
                                        // ドラッグハンドルをクリックした場合は無視
                                        if ((e.target as HTMLElement).classList.contains('cursor-ew-resize')) return;
                                        setEditingShiftId(s.id);
                                        setEditModalTime({ startTime: displayStart, endTime: displayEnd });
                                        setEditingShift(s);
                                      };
                                      
                                      return (
                                        <div 
                                          key={s.id + '-' + idx} 
                                          className="absolute top-1/4 h-1/2 rounded text-[12px] text-white flex items-center group cursor-pointer" 
                                          style={{ left: `${leftPct}%`, width: `${finalWidthPct}%`, backgroundColor: bgColor, zIndex: 20, boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}
                                          onClick={handleBarClick}
                                        >
                                          <div
                                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black hover:bg-opacity-30 rounded-l opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 bg-opacity-20"
                                            onMouseDown={(e) => handleDragStart(e, 'start')}
                                          />
                                          <div className="flex-1 text-left pl-3 pr-3 truncate pointer-events-none">{displayStart} - {displayEnd}</div>
                                          <div
                                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-black hover:bg-opacity-30 rounded-r opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 bg-opacity-20"
                                            onMouseDown={(e) => handleDragStart(e, 'end')}
                                          />
                                        </div>
                                      );
                                    })}
                                </div>
                              </div>
                            </div>
                          );
                          });
                        })()}
                      </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* シフト編集・承認モーダル */}
      {editingShiftId && editingShift && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => { setEditingShiftId(null); setEditingShift(null); setTempLabelId(undefined); }}>
          <div className="bg-white rounded-lg p-6 w-[480px]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold">シフト操作</h3>
                <div className="mt-2 text-sm text-gray-600">
                  <div className="flex items-center gap-2 mb-1">
                    <img src={avatarUrl(editingShift.avatarSeed || editingShift.userName, editingShift.avatarBgColor)} alt={editingShift.userName} className="w-6 h-6 rounded-full ring-1 ring-gray-200" />
                    <span className="font-medium">{editingShift.userName}</span>
                  </div>
                  <div>ステータス: <span className={`font-semibold ${editingShift.status === 'approved' ? 'text-green-600' : editingShift.status === 'rejected' ? 'text-red-600' : 'text-blue-600'}`}>
                    {editingShift.status === 'approved' ? '承認済み' : editingShift.status === 'rejected' ? '却下' : '申請中'}
                  </span></div>
                </div>
              </div>
              
              <div className="flex gap-2 ml-4">
                <button
                  disabled={editingShift.status === 'approved'}
                  onClick={async () => {
                    await approve(editingShiftId);
                    setEditingShiftId(null);
                    setEditingShift(null);
                    await fetchDayShifts(selectedDay!);
                  }}
                  className={`px-5 py-2.5 rounded-md font-semibold ${
                    editingShift.status === 'approved' 
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  承認
                </button>
                <button
                  onClick={async () => {
                    await reject(editingShiftId);
                    setEditingShiftId(null);
                    setEditingShift(null);
                    await fetchDayShifts(selectedDay!);
                  }}
                  className="px-5 py-2.5 bg-red-600 text-white rounded-md hover:bg-red-700 font-semibold"
                >
                  却下
                </button>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              {editingShift.status === 'approved' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">ラベル（色分け）</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                          setTempLabelId(null);
                        }}
                        className={`px-3 py-1.5 rounded border text-sm font-medium ${
                          (tempLabelId === undefined ? !editingShift.labelId : tempLabelId === null) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        なし
                      </button>
                      {shiftLabels.map(label => (
                        <button
                          key={label.id}
                          onClick={() => {
                            setTempLabelId(label.id);
                          }}
                          className={`px-3 py-1.5 rounded border text-sm font-medium transition-all hover:brightness-90 ${
                            (tempLabelId === undefined ? editingShift.labelId === label.id : tempLabelId === label.id) ? 'text-white border-transparent' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                          style={(tempLabelId === undefined ? editingShift.labelId === label.id : tempLabelId === label.id) ? { backgroundColor: label.color } : {}}
                        >
                          {label.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <button
                      onClick={async () => {
                        if (tempLabelId !== undefined) {
                          const editedTime = editedShifts.get(editingShiftId);
                          const updateData: any = { labelId: tempLabelId };
                          
                          // editedShiftsに時間変更がある場合は、その時間も一緒に保存
                          if (editedTime) {
                            updateData.startTime = editedTime.startTime;
                            updateData.endTime = editedTime.endTime;
                          }
                          
                          const newMap = new Map(editedShifts);
                          newMap.delete(editingShiftId);
                          setEditedShifts(newMap);
                          
                          await updateDoc(doc(db, 'shifts', editingShiftId), updateData);
                          await fetchDayShifts(selectedDay!);
                          setEditingShiftId(null);
                          setEditingShift(null);
                          setTempLabelId(undefined);
                        }
                      }}
                      disabled={tempLabelId === undefined}
                      className={`w-full py-2.5 rounded-md font-semibold ${
                        tempLabelId === undefined
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      役職確定
                    </button>
                  </div>

                  <div className="border-t pt-4">
                    <button
                      onClick={() => {
                        setSplitMode(!splitMode);
                        if (!splitMode) {
                          const start = editModalTime.startTime;
                          const end = editModalTime.endTime;
                          const startMin = parseInt(start.split(':')[0]) * 60 + parseInt(start.split(':')[1]);
                          const endMin = parseInt(end.split(':')[0]) * 60 + parseInt(end.split(':')[1]);
                          const midMin = Math.floor((startMin + endMin) / 2);
                          const midHour = Math.floor(midMin / 60);
                          const midMinute = midMin % 60;
                          setSplitTime(`${String(midHour).padStart(2, '0')}:${String(midMinute).padStart(2, '0')}`);
                        }
                      }}
                      className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium text-sm"
                    >
                      {splitMode ? 'キャンセル' : 'シフトを分割（例: ホール→キッチン）'}
                    </button>
                    
                    {splitMode && (
                      <div className="mt-4 space-y-4 bg-indigo-50 p-4 rounded-md">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">分割時刻</label>
                          <input
                            type="time"
                            value={splitTime}
                            onChange={(e) => setSplitTime(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <p className="text-xs text-gray-600 mt-1">この時刻で2つのシフトに分割されます</p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-700 mb-2">前半 ({editModalTime.startTime}～{splitTime})</p>
                            <div className="space-y-1">
                              {shiftLabels.map(label => (
                                <button
                                  key={label.id}
                                  onClick={async () => {
                                    if (!splitTime || splitTime <= editModalTime.startTime || splitTime >= editModalTime.endTime) {
                                      alert('有効な分割時刻を入力してください');
                                      return;
                                    }
                                    
                                    try {
                                      // 元のシフトを前半に更新
                                      await updateDoc(doc(db, 'shifts', editingShiftId), {
                                        endTime: splitTime,
                                        labelId: label.id,
                                      });
                                      
                                      // 後半の新しいシフトを作成
                                      const userRef = doc(db, 'users', editingShift.userId);
                                      const dateTs = Timestamp.fromDate(editingShift.date);
                                      
                                      await addDoc(collection(db, 'shifts'), {
                                        organizationId: userProfile!.currentOrganizationId,
                                        userRef: userRef,
                                        createdTime: Timestamp.now(),
                                        date: dateTs,
                                        startTime: splitTime,
                                        endTime: editModalTime.endTime,
                                        originalStartTime: editingShift.originalStartTime,
                                        originalEndTime: editingShift.originalEndTime,
                                        note: editingShift.note || '',
                                        hourlyWage: editingShift.hourlyWage,
                                        status: 'approved',
                                        approvedBy: null,
                                        approvedAt: null,
                                        rejectReason: null,
                                        labelId: null,
                                      });
                                      
                                      console.log('[Split] シフト分割成功');
                                      
                                      // 編集中のシフトをクリア
                                      const newEditedShifts = new Map(editedShifts);
                                      newEditedShifts.delete(editingShiftId);
                                      setEditedShifts(newEditedShifts);
                                      
                                      setSplitMode(false);
                                      setEditingShiftId(null);
                                      setEditingShift(null);
                                      await fetchDayShifts(selectedDay!);
                                      alert('前半を「' + label.name + '」に設定しました。後半のラベルも設定してください。');
                                    } catch (e) {
                                      console.error('Split failed', e);
                                      alert('分割に失敗しました');
                                    }
                                  }}
                                  className="w-full px-3 py-2 rounded text-sm font-medium text-white"
                                  style={{ backgroundColor: label.color }}
                                >
                                  {label.name}
                                </button>
                              ))}
                            </div>
                          </div>
                          
                          <div>
                            <p className="text-sm font-medium text-gray-700 mb-2">後半 ({splitTime}～{editModalTime.endTime})</p>
                            <p className="text-xs text-gray-600">前半のラベルを選択後、後半のシフトをクリックしてラベルを設定できます</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">開始時刻</label>
                <input
                  type="time"
                  value={editModalTime.startTime}
                  onChange={(e) => setEditModalTime(prev => ({ ...prev, startTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">終了時刻</label>
                <input
                  type="time"
                  value={editModalTime.endTime}
                  onChange={(e) => setEditModalTime(prev => ({ ...prev, endTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditingShiftId(null); setEditingShift(null); }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    if (editModalTime.startTime && editModalTime.endTime) {
                      setEditedShifts(prev => new Map(prev).set(editingShiftId, editModalTime));
                      setEditingShiftId(null);
                      setEditingShift(null);
                    } else {
                      alert('開始時刻と終了時刻を入力してください');
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  時間を変更
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ラベル管理モーダル */}
      {showLabelManager && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowLabelManager(false)}>
          <div className="bg-white rounded-lg p-6 w-[500px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">役職ラベル管理</h3>
            
            {/* 既存ラベル一覧 */}
            <div className="space-y-2 mb-4">
              {shiftLabels.map(label => (
                <div key={label.id} className="flex items-center gap-2 p-3 border rounded">
                  <div className="w-6 h-6 rounded" style={{ backgroundColor: label.color }}></div>
                  <span className="flex-1 font-medium">{label.name}</span>
                  <button
                    onClick={() => {
                      setEditingLabelId(label.id);
                      setEditingLabelName(label.name);
                      setEditingLabelColor(label.color);
                    }}
                    className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                  >
                    編集
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`「${label.name}」を削除しますか？`)) {
                        const updatedLabels = shiftLabels.filter(l => l.id !== label.id);
                        setShiftLabels(updatedLabels);
                        // Firestoreに保存
                        if (userProfile?.currentOrganizationId) {
                          try {
                            await updateDoc(doc(db, 'organizations', userProfile.currentOrganizationId), {
                              shiftLabels: updatedLabels
                            });
                          } catch (e) {
                            console.error('ラベルの削除に失敗:', e);
                          }
                        }
                        // 選択中の日付のシフトを再読み込みして表示を更新
                        if (selectedDay) {
                          fetchDayShifts(selectedDay);
                        }
                      }
                    }}
                    className="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded"
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>

            {/* 新規追加・編集フォーム */}
            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">{editingLabelId ? 'ラベルを編集' : '新しいラベルを追加'}</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
                  <input
                    type="text"
                    value={editingLabelName}
                    onChange={(e) => setEditingLabelName(e.target.value)}
                    placeholder="例: ホール、キッチン"
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">色</label>
                  <div className="flex flex-wrap gap-2">
                    {availableColors.map(color => (
                      <button
                        key={color.value}
                        onClick={() => setEditingLabelColor(color.value)}
                        className={`w-10 h-10 rounded border-2 ${editingLabelColor === color.value ? 'border-gray-900' : 'border-gray-300'}`}
                        style={{ backgroundColor: color.value }}
                        title={color.name}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  {editingLabelId && (
                    <button
                      onClick={() => {
                        setEditingLabelId(null);
                        setEditingLabelName('');
                        setEditingLabelColor('#8b5cf6');
                      }}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded"
                    >
                      キャンセル
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (!editingLabelName.trim()) {
                        alert('名称を入力してください');
                        return;
                      }
                      
                      let updatedLabels: ShiftLabel[];
                      if (editingLabelId) {
                        // 編集
                        updatedLabels = shiftLabels.map(l => 
                          l.id === editingLabelId 
                            ? { ...l, name: editingLabelName, color: editingLabelColor }
                            : l
                        );
                        setShiftLabels(updatedLabels);
                        setEditingLabelId(null);
                      } else {
                        // 新規追加
                        const newId = `label-${Date.now()}`;
                        updatedLabels = [...shiftLabels, { 
                          id: newId, 
                          name: editingLabelName, 
                          color: editingLabelColor 
                        }];
                        setShiftLabels(updatedLabels);
                      }
                      // Firestoreに保存
                      if (userProfile?.currentOrganizationId) {
                        try {
                          await updateDoc(doc(db, 'organizations', userProfile.currentOrganizationId), {
                            shiftLabels: updatedLabels
                          });
                        } catch (e) {
                          console.error('ラベルの保存に失敗:', e);
                        }
                      }
                      // 選択中の日付のシフトを再読み込みして表示を更新
                      if (selectedDay) {
                        fetchDayShifts(selectedDay);
                      }
                      setEditingLabelName('');
                      setEditingLabelColor('#8b5cf6');
                    }}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
                  >
                    {editingLabelId ? '更新' : '追加'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t">
              <button
                onClick={() => setShowLabelManager(false)}
                className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded font-medium"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
