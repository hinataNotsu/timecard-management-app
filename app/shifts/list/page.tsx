'use client';

import { useEffect, useMemo, useState } from 'react';
import JapaneseHolidays from 'japanese-holidays';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDoc, getDocs, query, where, orderBy, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Timestamp } from 'firebase/firestore';

interface ShiftRow {
  id: string;
  userId: string;
  userName: string;
  avatarSeed?: string;
  avatarBgColor?: string;
  date: Date;
  startTime: string;
  endTime: string;
  note?: string;
  hourlyWage?: number;
  status?: 'pending' | 'approved' | 'rejected';
  approvedByName?: string | null;
  approvedAt?: Date | null;
  rejectReason?: string | null;
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
  const [orgSettings, setOrgSettings] = useState<{ defaultHourlyWage: number; nightPremiumEnabled: boolean; nightPremiumRate: number; nightStart: string; nightEnd: string } | null>(null);
  const [allOrgUsers, setAllOrgUsers] = useState<{ id: string; name: string; seed?: string; bgColor?: string }[]>([]);

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
              // 削除されたユーザーの場合は「(退職済み) 名前」と表示
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
            // ユーザードキュメントが存在しない場合は削除済みとみなす
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
          rows.push({
            id: d.id,
            userId,
            userName,
            avatarSeed,
            avatarBgColor,
            date: dateTs.toDate(),
            startTime: data.startTime,
            endTime: data.endTime,
            note: data.note || '',
            hourlyWage: data.hourlyWage != null ? Number(data.hourlyWage) : undefined,
            status: (data.status as any) || 'pending',
            approvedByName: await getApproverName(data.approvedBy),
            approvedAt: data.approvedAt ? (data.approvedAt as Timestamp).toDate() : null,
            rejectReason: data.rejectReason || null,
          });
        }

        setShifts(rows);
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
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th className="sticky left-0 bg-gray-50 z-10 p-2 border border-gray-300/50 text-center min-w-[120px]">ユーザー</th>
                  {daysInMonth.map(day => {
                    const dow = day.getDay();
                    const holiday = JapaneseHolidays.isHoliday(day);
                    const dateColor = holiday || dow === 0 ? 'text-red-600' : dow === 6 ? 'text-blue-600' : 'text-gray-900';
                    const weekColor = holiday || dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-500';
                    return (
                      <th key={day.toISOString()} className="p-2 border border-gray-300/50 text-center min-w-[80px]">
                        <div className={dateColor}>{day.getDate()}</div>
                        <div className={`text-[10px] ${weekColor}`}>{['日','月','火','水','木','金','土'][dow]}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {usersForCalendar.map(user => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="sticky left-0 bg-white z-10 p-2 border border-gray-300/50">
                      <div className="flex items-center gap-2">
                        <img src={avatarUrl(user.seed || user.name || user.id, user.bgColor)} alt={user.name} className="w-6 h-6 rounded-full ring-1 ring-gray-200" />
                        <span className="text-sm">{user.name}</span>
                      </div>
                    </td>
                    {daysInMonth.map(day => {
                      const shift = getShiftForUserDate(user.id, day);
                      const dayShifts = shifts.filter(s => 
                        s.date.getFullYear() === day.getFullYear() &&
                        s.date.getMonth() === day.getMonth() &&
                        s.date.getDate() === day.getDate()
                      );
                      const hasOverlap = dayShifts.length > 1 && dayShifts.some((s1, i) => 
                        dayShifts.slice(i + 1).some(s2 => {
                          const start1 = parseInt(s1.startTime.replace(':', ''));
                          const end1 = parseInt(s1.endTime.replace(':', ''));
                          const start2 = parseInt(s2.startTime.replace(':', ''));
                          const end2 = parseInt(s2.endTime.replace(':', ''));
                          return !(end1 <= start2 || end2 <= start1);
                        })
                      );
                      
                      return (
                        <td key={day.toISOString()} className={`p-1 border border-gray-300/50 text-center align-top ${hasOverlap ? 'bg-yellow-50' : ''}`}>
                          {shift ? (
                            <div className="text-[10px] space-y-0.5 group relative">
                              <div className="font-semibold">{shift.startTime}-{shift.endTime}</div>
                              {shift.status === 'approved' && <span className="inline-block px-1 rounded bg-green-100 text-green-700">承認</span>}
                              {shift.status === 'pending' && (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-block px-1 rounded bg-gray-100 text-gray-600">申請</span>
                                  <div className="opacity-0 group-hover:opacity-100 flex gap-0.5">
                                    <button onClick={() => approve(shift.id)} className="px-1 py-0.5 rounded bg-green-500 text-white text-[9px] hover:bg-green-600">✓</button>
                                    <button onClick={() => reject(shift.id)} className="px-1 py-0.5 rounded bg-red-500 text-white text-[9px] hover:bg-red-600">✗</button>
                                  </div>
                                </div>
                              )}
                              {shift.status === 'rejected' && <span className="inline-block px-1 rounded bg-red-100 text-red-600">却下</span>}
                              {hasOverlap && <div className="text-[9px] text-yellow-700">⚠️重複</div>}
                            </div>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
