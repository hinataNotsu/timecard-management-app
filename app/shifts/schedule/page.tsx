'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDoc, getDocs, orderBy, query, where, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import JapaneseHolidays from 'japanese-holidays';

type ShiftRow = {
  userId: string;
  userName: string;
  avatarSeed?: string;
  avatarBgColor?: string;
  date: Date;
  startTime: string;
  endTime: string;
};

export default function ApprovedSchedulePage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [indexInfo, setIndexInfo] = useState<null | { status: 'building' | 'missing'; url?: string }>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedDayForTimeline, setSelectedDayForTimeline] = useState<Date | null>(null);

  useEffect(() => {
    if (!userProfile) return;
    if (!userProfile.currentOrganizationId) {
      router.push('/join-organization');
      return;
    }
  }, [userProfile, router]);

  useEffect(() => {
    const load = async () => {
      if (!userProfile?.currentOrganizationId) return;
      setLoading(true);
      try {
        const orgId = userProfile.currentOrganizationId;
        const y = selectedMonth.getFullYear();
        const m = selectedMonth.getMonth();
        const monthStart = new Date(y, m, 1, 0, 0, 0, 0);
        const nextMonthStart = new Date(y, m + 1, 1, 0, 0, 0, 0);

        const qy = query(
          collection(db, 'shifts'),
          where('organizationId', '==', orgId),
          where('status', '==', 'approved'),
          where('date', '>=', Timestamp.fromDate(monthStart)),
          where('date', '<', Timestamp.fromDate(nextMonthStart)),
          orderBy('date', 'asc'),
        );
        const snap = await getDocs(qy);

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
              name = data.displayName || userId;
              seed = data.avatarSeed || name || userId;
              bgColor = data.avatarBackgroundColor;
            }
          } catch {}
          const info = { name, seed, bgColor };
          userCache.set(userId, info);
          return info;
        };

        const list: ShiftRow[] = [];
        for (const d of snap.docs) {
          const data = d.data() as any;
          const dateTs: Timestamp = data.date as Timestamp;
          const userRefPath: string = data.userRef?.path || '';
          const userId = userRefPath.split('/').pop();
          if (!userId) continue;
          const { name: userName, seed: avatarSeed, bgColor: avatarBgColor } = await getUserInfo(userId);
          list.push({
            userId,
            userName,
            avatarSeed,
            avatarBgColor,
            date: dateTs.toDate(),
            startTime: data.startTime,
            endTime: data.endTime,
          });
        }
        setRows(list);
        setIndexInfo(null);
      } catch (e: any) {
        console.error('[Schedule] load error', e);
        const msg = String(e?.message || e || '');
        if (msg.includes('requires an index')) {
          const urlMatch = msg.match(/https:\/\/console\.firebase\.google\.com\/[\S]+/);
          const url = urlMatch ? urlMatch[0] : undefined;
          if (msg.includes('currently building')) {
            setIndexInfo({ status: 'building', url });
          } else {
            setIndexInfo({ status: 'missing', url });
          }
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userProfile?.currentOrganizationId, selectedMonth, reloadToken]);

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));

  const formatDateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const getCalendarDays = (date: Date): Date[] => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const start = new Date(firstDay);
    start.setDate(start.getDate() - firstDay.getDay());
    const days: Date[] = [];
    const cur = new Date(start);
    while (days.length < 42) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  };

  const filteredRows = useMemo(() => {
    const name = nameFilter.trim();
    return rows.filter(r => {
      if (onlyMine && r.userId !== userProfile?.uid) return false;
      if (name && !r.userName.toLowerCase().includes(name.toLowerCase())) return false;
      return true;
    });
  }, [rows, nameFilter, onlyMine, userProfile?.uid]);

  const grouped = useMemo(() => {
    const map = new Map<string, ShiftRow[]>();
    for (const r of filteredRows) {
      const k = formatDateKey(r.date);
      const arr = map.get(k) || [];
      arr.push(r);
      map.set(k, arr);
    }
    return map;
  }, [filteredRows]);

  const exportCsv = () => {
    const y = selectedMonth.getFullYear();
    const m = selectedMonth.getMonth() + 1;
    const header = ['日付','曜日','氏名','開始','終了','時間(分)'];
    const dowJp = ['日','月','火','水','木','金','土'];
    const timeToMin = (t: string) => {
      const [hh, mm] = t.split(':').map(Number);
      return hh * 60 + mm;
    };
    const rowsCsv = filteredRows
      .slice()
      .sort((a,b) => a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime))
      .map(r => {
        const d = r.date;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const w = dowJp[d.getDay()];
        const minutes = Math.max(0, timeToMin(r.endTime) - timeToMin(r.startTime));
        return [dateStr, w, r.userName, r.startTime, r.endTime, String(minutes)];
      });
    const csv = [header, ...rowsCsv].map(cols => cols.map(c => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `承認済みシフト_${y}-${String(m).padStart(2,'0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">承認済みシフト（組織全体）</h1>
          <button onClick={() => router.push('/dashboard/part-time')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        {indexInfo && (
          <div className={`mb-4 rounded-lg border p-4 ${indexInfo.status === 'building' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
            <p className={`${indexInfo.status === 'building' ? 'text-yellow-800' : 'text-red-800'} text-sm`}>
              {indexInfo.status === 'building'
                ? 'Firestoreのインデックスを作成中です。数分後に再読み込みしてください。'
                : 'この表示にはFirestoreのインデックスが必要です。インデックスを作成してから再読み込みしてください。'}
              {indexInfo.url && (
                <>
                  {' '}
                  <a href={indexInfo.url} target="_blank" rel="noreferrer" className="underline font-medium">
                    コンソールで確認
                  </a>
                </>
              )}
            </p>
            <div className="mt-3">
              <button onClick={() => setReloadToken(v => v + 1)} className="px-3 py-1 rounded border bg-white hover:bg-gray-50 text-gray-800">再読み込み</button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap items-center gap-3 print:hidden">
          <button onClick={prevMonth} className="px-2 py-1 border rounded">←</button>
          <div className="font-semibold">{selectedMonth.getFullYear()}年 {selectedMonth.getMonth() + 1}月</div>
          <button onClick={nextMonth} className="px-2 py-1 border rounded">→</button>

          <div className="flex items-center gap-2 ml-4">
            <input
              type="text"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="氏名でフィルタ"
              className="px-2 py-1 border rounded"
            />
            <label className="flex items-center gap-1 text-sm text-gray-700">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> 自分だけ表示
            </label>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => window.print()} className="px-3 py-1 rounded border bg-white hover:bg-gray-50">印刷</button>
            <button onClick={exportCsv} className="px-3 py-1 rounded border bg-white hover:bg-gray-50">CSV出力</button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="grid grid-cols-7 border-b border-gray-300 border-opacity-50">
            {['日','月','火','水','木','金','土'].map((w, i) => (
              <div key={w} className={`p-3 text-center font-semibold border-r border-gray-300 border-opacity-50 last:border-r-0 ${i===0?'text-red-600':i===6?'text-blue-600':''}`}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {getCalendarDays(selectedMonth).map((day, idx) => {
              const key = formatDateKey(day);
              const curMonth = selectedMonth.getMonth();
              const isCurrentMonth = day.getMonth() === curMonth;
              const isToday = new Date().toDateString() === day.toDateString();
              const dow = day.getDay();
              const holiday = JapaneseHolidays.isHoliday(day);
              const list = (grouped.get(key) || []).sort((a,b) => a.startTime.localeCompare(b.startTime));
              return (
                <div
                  key={idx}
                  className={`min-h-24 p-2 border-r border-b border-gray-300 border-opacity-50 last:border-r-0 ${!isCurrentMonth?'bg-gray-50':''} ${isToday?'bg-green-50':''}`}
                  onClick={() => setSelectedDayForTimeline(day)}
                >
                  <div className={`text-sm ${!isCurrentMonth ? 'text-gray-400' : holiday || dow===0 ? 'text-red-600' : dow===6 ? 'text-blue-600' : 'text-gray-900'} ${isToday ? 'font-bold' : ''}`}>{day.getDate()}</div>
                  <div className="mt-1 space-y-1">
                    {loading ? (
                      <div className="text-xs text-gray-400">読み込み中...</div>
                    ) : list.length === 0 ? null : (
                      <>
                        {/* Desktop / wide: show time and name */}
                        <div className="hidden sm:block space-y-1">
                          {list.map((s, i2) => (
                            <div key={i2} className="w-full text-left text-xs bg-green-100 text-green-800 px-1 py-0.5 rounded truncate flex items-center gap-1">
                              <img
                                src={`https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(s.avatarSeed || s.userName || s.userId)}${s.avatarBgColor ? `&backgroundColor=${encodeURIComponent(s.avatarBgColor)}` : '&backgroundType=gradientLinear'}&radius=50`}
                                alt={s.userName}
                                className="w-4 h-4 rounded-full"
                              />
                              <span className="truncate">{s.startTime}-{s.endTime} {s.userName}</span>
                            </div>
                          ))}
                        </div>

                        {/* Mobile: show avatars only, if many show "他N名" */}
                        <div className="flex items-center gap-2 sm:hidden">
                          {(() => {
                            const max = 4;
                            const slice = list.slice(0, max);
                            const more = Math.max(0, list.length - max);
                            return (
                              <>
                                {slice.map((s, i2) => (
                                  <img key={i2} src={`https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(s.avatarSeed || s.userName || s.userId)}${s.avatarBgColor ? `&backgroundColor=${encodeURIComponent(s.avatarBgColor)}` : '&backgroundType=gradientLinear'}&radius=50`} alt={s.userName} className="w-6 h-6 rounded-full" />
                                ))}
                                {more > 0 && (
                                  <div className="text-xs text-gray-600">他{more}名</div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 当日の時間軸モーダル */}
        {selectedDayForTimeline && (
          <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
            <div className="bg-white rounded-lg p-4 w-full max-w-4xl max-h-[90vh] overflow-auto">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold">{selectedDayForTimeline.getFullYear()}年{selectedDayForTimeline.getMonth()+1}月{selectedDayForTimeline.getDate()}日のシフト（時間軸）</div>
                <button onClick={() => setSelectedDayForTimeline(null)} className="px-3 py-1 border rounded">閉じる</button>
              </div>
              <div className="text-sm text-gray-600 mb-2">※ 承認済みのシフトのみ表示</div>
              <div className="relative">
                {/* unified vertical markers overlay spanning header and rows */}
                <div className="absolute top-0 bottom-0 left-0 right-0 pointer-events-none">
                  <div style={{ position: 'absolute', left: 'calc(6rem + 1rem)', right: 0, top: 0, bottom: 0 }}>
                    {[0,6,12,18,24].map((h) => (
                      <div key={`marker-${h}`} style={{ position: 'absolute', left: `${(h/24)*100}%`, top: 0, bottom: 0, width: '1px', background: 'rgba(156,163,175,0.9)' }} />
                    ))}
                  </div>
                </div>

                {/* 時間軸ヘッダー（6時間ごと: 0,6,12,18,24） */}
                <div className="flex items-center gap-4 mb-2 relative z-10">
                  <div className="w-24 text-sm text-gray-600">名前</div>
                  <div className="flex-1">
                    <div className="relative h-8">
                      {([0,6,12,18,24] as number[]).map((h) => (
                        <div key={h} className="absolute top-0 h-full text-xs text-gray-500 flex items-center justify-center" style={{ left: `${(h/24)*100}%`, transform: 'translateX(-50%)' }}>
                          {h === 24 ? '24:00' : `${h.toString().padStart(2,'0')}:00`}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* シフト行 */}
                <div className="divide-y divide-gray-300 relative z-10">
                  {(() => {
                    const key = formatDateKey(selectedDayForTimeline);
                    const dayList = (grouped.get(key) || []).sort((a,b) => a.startTime.localeCompare(b.startTime));
                    if (dayList.length === 0) return <div className="text-sm text-gray-500">この日の承認済みシフトはありません</div>;
                    return dayList.map((s, idx) => {
                      const toMin = (t: string) => { const [hh, mm] = t.split(':').map(Number); return hh*60+mm; };
                      const startMin = toMin(s.startTime);
                      const endMin = toMin(s.endTime);
                      const leftPct = (startMin / (24*60)) * 100;
                      const widthPct = Math.max(1, ((endMin - startMin) / (24*60)) * 100);
                      return (
                        <div key={idx} className="flex items-center gap-4 py-1">
                          <div className="w-24 text-sm flex items-center gap-2">
                            <img src={`https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(s.avatarSeed || s.userName || s.userId)}${s.avatarBgColor ? `&backgroundColor=${encodeURIComponent(s.avatarBgColor)}` : '&backgroundType=gradientLinear'}&radius=50`} alt={s.userName} className="w-6 h-6 rounded-full" />
                            <div className="truncate">{s.userName}</div>
                          </div>
                          <div className="flex-1 relative">
                            <div className="relative h-10">
                              {/** shift bar overlay */}
                              <div className="absolute top-1 bottom-1 left-0 right-0 pointer-events-none">
                                <div className="absolute h-full bg-green-500 text-white rounded-md flex items-center px-2 text-xs" style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                                  {s.startTime}-{s.endTime}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}
        <style jsx global>{`
          @media print {
            @page { size: A4 landscape; margin: 12mm; }
            body { background: white; }
          }
        `}</style>
      </div>
    </div>
  );
}
