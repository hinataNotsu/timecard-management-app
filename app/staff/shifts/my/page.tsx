'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Timestamp } from 'firebase/firestore';

interface ShiftRow {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  note?: string;
}

export default function MyShiftListPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  useEffect(() => {
    if (!userProfile?.currentOrganizationId) {
      router.push('/dashboard/part-time');
    }
  }, [userProfile, router]);

  useEffect(() => {
    const load = async () => {
      if (!userProfile?.uid || !userProfile?.currentOrganizationId) return;
      setLoading(true);
      try {
        const usersRef = doc(db, 'users', userProfile.uid);
        // 月範囲でサーバーサイド絞り込み（indexあり想定）
        const y = selectedMonth.getFullYear();
        const m = selectedMonth.getMonth();
        const monthStart = new Date(y, m, 1, 0, 0, 0, 0);
        const nextMonthStart = new Date(y, m + 1, 1, 0, 0, 0, 0);
        const q = query(
          collection(db, 'shifts'),
          where('organizationId', '==', userProfile.currentOrganizationId),
          where('userRef', '==', usersRef),
          where('date', '>=', Timestamp.fromDate(monthStart)),
          where('date', '<', Timestamp.fromDate(nextMonthStart)),
          orderBy('date', 'asc')
        );
        const snap = await getDocs(q);
        const list: ShiftRow[] = snap.docs.map(d => {
          const data = d.data() as any;
          const dateTs: Timestamp = data.date;
          return {
            id: d.id,
            date: dateTs.toDate(),
            startTime: data.startTime,
            endTime: data.endTime,
            note: data.note || '',
          };
        });
        setShifts(list);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userProfile?.uid, userProfile?.currentOrganizationId, selectedMonth]);

  const filtered = useMemo(() => {
    return [...shifts].sort((a, b) => a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime));
  }, [shifts]);

  const prevMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  const nextMonth = () => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));
  const fmt = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">マイシフト一覧</h1>
          <button onClick={() => router.push('/staff/dashboard')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-3">
          <button onClick={prevMonth} className="px-2 py-1 border rounded">←</button>
          <div className="font-semibold">{selectedMonth.getFullYear()}年 {selectedMonth.getMonth() + 1}月</div>
          <button onClick={nextMonth} className="px-2 py-1 border rounded">→</button>
          <div className="ml-auto">
            <button onClick={() => router.push('/shifts/submit')} className="px-3 py-1 border rounded hover:bg-gray-50">カレンダーへ</button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2 border-b">日付</th>
                <th className="text-left p-2 border-b">時間帯</th>
                <th className="text-left p-2 border-b">備考</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4" colSpan={3}>読み込み中...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4" colSpan={3}>該当データがありません</td></tr>
              ) : (
                filtered.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="p-2 border-b">{fmt(row.date)}</td>
                    <td className="p-2 border-b">{row.startTime} - {row.endTime}</td>
                    <td className="p-2 border-b">{row.note}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
