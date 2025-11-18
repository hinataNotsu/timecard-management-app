'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, getDocs, doc, updateDoc, deleteDoc, Timestamp, orderBy, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Timecard } from '@/types';

interface TimecardRow {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  dateKey: string;
  date: Timestamp;
  clockIn?: Timestamp;
  clockOut?: Timestamp;
  breakTime: number; // minutes
  hourlyWage: number;
  status: 'in_progress' | 'completed';
  totalHours?: number;
  totalPay?: number;
  isEditing?: boolean;
}

export default function TimecardsPage() {
  const { userProfile, loading } = useAuth();
  const router = useRouter();
  const [timecards, setTimecards] = useState<TimecardRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  useEffect(() => {
    if (!loading && (!userProfile || !userProfile.isManage)) {
      router.push('/dashboard/part-time');
    }
  }, [userProfile, loading, router]);

  useEffect(() => {
    const fetchTimecards = async () => {
      if (!userProfile?.currentOrganizationId) return;
      
      setLoadingData(true);
      try {
        const q = query(
          collection(db, 'timecards'),
          where('organizationId', '==', userProfile.currentOrganizationId),
          orderBy('dateKey', 'desc')
        );
        const snapshot = await getDocs(q);

        const raw = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

        // ユーザー名の取得（キャッシュ）
        const uniqueUserIds = Array.from(new Set(raw.map(r => r.userId).filter(Boolean)));
        const nameMap = new Map<string, string>();
        await Promise.all(uniqueUserIds.map(async (uid) => {
          try {
            const u = await getDoc(doc(db, 'users', uid));
            if (u.exists()) {
              const udata = u.data() as any;
              nameMap.set(uid, (udata.deleted ? `(退職済み) ${udata.displayName || uid}` : (udata.displayName || uid)));
            } else {
              nameMap.set(uid, uid);
            }
          } catch {
            nameMap.set(uid, uid);
          }
        }));

        const data: TimecardRow[] = raw.map((r: any) => {
          const dateTs = Timestamp.fromDate(new Date(`${r.dateKey}T00:00:00`));
          const breakMinutes = (r.breakStartAt && r.breakEndAt)
            ? Math.max(0, Math.floor((r.breakEndAt.toMillis() - r.breakStartAt.toMillis()) / 60000))
            : 0;
          const status: 'in_progress' | 'completed' = r.clockOutAt ? 'completed' : 'in_progress';
          return {
            id: r.id,
            organizationId: r.organizationId,
            userId: r.userId,
            userName: nameMap.get(r.userId) || r.userId,
            dateKey: r.dateKey,
            date: dateTs,
            clockIn: r.clockInAt,
            clockOut: r.clockOutAt,
            breakTime: breakMinutes,
            hourlyWage: Number(r.hourlyWage ?? 0),
            status,
          };
        });

        setTimecards(data);
      } catch (error) {
        console.error('[Timecards] Error fetching timecards:', error);
      } finally {
        setLoadingData(false);
      }
    };

    fetchTimecards();
  }, [userProfile]);

  const formatDateTime = (timestamp: Timestamp) => {
    const date = timestamp.toDate();
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (timestamp: Timestamp) => {
    const date = timestamp.toDate();
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const formatTime = (timestamp: Timestamp) => {
    const date = timestamp.toDate();
    return date.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const toggleEdit = (id: string) => {
    setTimecards(prev => prev.map(tc => 
      tc.id === id ? { ...tc, isEditing: !tc.isEditing } : tc
    ));
  };

  const updateField = (id: string, field: keyof TimecardRow, value: any) => {
    setTimecards(prev => prev.map(tc =>
      tc.id === id ? { ...tc, [field]: value } : tc
    ));
  };

  const saveTimecard = async (id: string) => {
    const timecard = timecards.find(tc => tc.id === id);
    if (!timecard) return;

    setSaving(id);
    try {
      const updateData: any = {
        breakTime: timecard.breakTime,
        hourlyWage: timecard.hourlyWage,
        updatedAt: Timestamp.now(),
      };

      // 出勤・退勤時刻の更新
      if (timecard.clockIn) updateData.clockIn = timecard.clockIn;
      if (timecard.clockOut) updateData.clockOut = timecard.clockOut;

      // 総労働時間と給与を再計算
      if (timecard.clockOut && timecard.clockIn) {
        const workMinutes = (timecard.clockOut.toMillis() - timecard.clockIn.toMillis()) / 60000;
        const totalHours = Math.max(0, (workMinutes - timecard.breakTime) / 60);
        updateData.totalHours = totalHours;
        updateData.totalPay = totalHours * timecard.hourlyWage;
        updateData.status = 'completed';
      }

      await updateDoc(doc(db, 'timecards', id), updateData);
      
      // ローカル状態を更新
      setTimecards(prev => prev.map(tc =>
        tc.id === id ? { 
          ...tc, 
          ...updateData,
          isEditing: false 
        } : tc
      ));

      alert('保存しました');
    } catch (error) {
      console.error('[Timecards] Error saving timecard:', error);
      alert('保存に失敗しました');
    } finally {
      setSaving(null);
    }
  };

  const deleteTimecard = async (id: string, userName: string) => {
    if (!confirm(`${userName}のタイムカードを削除しますか？`)) return;

    setDeleting(id);
    try {
      await deleteDoc(doc(db, 'timecards', id));
      setTimecards(prev => prev.filter(tc => tc.id !== id));
      alert('削除しました');
    } catch (error) {
      console.error('[Timecards] Error deleting timecard:', error);
      alert('削除に失敗しました');
    } finally {
      setDeleting(null);
    }
  };

  const parseDateTime = (dateStr: string, timeStr: string): Timestamp => {
    const combined = `${dateStr}T${timeStr}:00`;
    return Timestamp.fromDate(new Date(combined));
  };

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  // フィルター適用
  const filteredTimecards = timecards.filter(tc => {
    if (!startDate && !endDate) return true;
    const tcDate = tc.dateKey;
    if (startDate && tcDate < startDate) return false;
    if (endDate && tcDate > endDate) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">タイムカード管理</h1>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="開始日"
              />
              <span className="text-gray-500">～</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="終了日"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="px-2 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                  title="フィルターをクリア"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <button
            onClick={() => router.push('/dashboard/company')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← ダッシュボード
          </button>
        </div>

        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 border-b text-left">日付</th>
                <th className="p-3 border-b text-left">氏名</th>
                <th className="p-3 border-b text-left">出勤</th>
                <th className="p-3 border-b text-left">退勤</th>
                <th className="p-3 border-b text-center">休憩(分)</th>
                <th className="p-3 border-b text-center">時給</th>
                <th className="p-3 border-b text-center">労働時間</th>
                <th className="p-3 border-b text-center">給与</th>
                <th className="p-3 border-b text-center">状態</th>
                <th className="p-3 border-b text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredTimecards.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-gray-500">
                    タイムカードがありません
                  </td>
                </tr>
              ) : (
                filteredTimecards.map(tc => (
                  <tr key={tc.id} className="hover:bg-gray-50">
                    <td className="p-3 border-b">{formatDate(tc.date)}</td>
                    <td className="p-3 border-b">{tc.userName}</td>
                    <td className="p-3 border-b">
                      {tc.isEditing ? (
                        tc.clockIn ? (
                          <input
                            type="datetime-local"
                            value={tc.clockIn.toDate().toISOString().slice(0, 16)}
                            onChange={(e) => {
                              const newDate = new Date(e.target.value);
                              updateField(tc.id, 'clockIn', Timestamp.fromDate(newDate));
                            }}
                            className="px-2 py-1 border rounded text-sm"
                          />
                        ) : (
                          <span className="text-gray-400">未出勤</span>
                        )
                      ) : (
                        tc.clockIn ? formatTime(tc.clockIn) : <span className="text-gray-400">未出勤</span>
                      )}
                    </td>
                    <td className="p-3 border-b">
                      {tc.isEditing ? (
                        tc.clockOut ? (
                          <input
                            type="datetime-local"
                            value={tc.clockOut.toDate().toISOString().slice(0, 16)}
                            onChange={(e) => {
                              const newDate = new Date(e.target.value);
                              updateField(tc.id, 'clockOut', Timestamp.fromDate(newDate));
                            }}
                            className="px-2 py-1 border rounded text-sm"
                          />
                        ) : (
                          <span className="text-gray-400">未退勤</span>
                        )
                      ) : (
                        tc.clockOut ? formatTime(tc.clockOut) : <span className="text-gray-400">未退勤</span>
                      )}
                    </td>
                    <td className="p-3 border-b text-center">
                      {tc.isEditing ? (
                        <input
                          type="number"
                          min={0}
                          value={tc.breakTime}
                          onChange={(e) => updateField(tc.id, 'breakTime', Number(e.target.value))}
                          className="w-20 px-2 py-1 border rounded text-center"
                        />
                      ) : (
                        tc.breakTime
                      )}
                    </td>
                    <td className="p-3 border-b text-center">
                      {tc.isEditing ? (
                        <input
                          type="number"
                          min={0}
                          value={tc.hourlyWage}
                          onChange={(e) => updateField(tc.id, 'hourlyWage', Number(e.target.value))}
                          className="w-24 px-2 py-1 border rounded text-center"
                        />
                      ) : (
                        `¥${tc.hourlyWage.toLocaleString()}`
                      )}
                    </td>
                    <td className="p-3 border-b text-center">
                      {tc.totalHours ? `${tc.totalHours.toFixed(2)}h` : '-'}
                    </td>
                    <td className="p-3 border-b text-center">
                      {tc.totalPay ? `¥${Math.floor(tc.totalPay).toLocaleString()}` : '-'}
                    </td>
                    <td className="p-3 border-b text-center">
                      <span className={`px-2 py-1 rounded text-xs ${
                        tc.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {tc.status === 'completed' ? '完了' : '勤務中'}
                      </span>
                    </td>
                    <td className="p-3 border-b text-center">
                      <div className="flex gap-1 justify-center">
                        {tc.isEditing ? (
                          <>
                            <button
                              onClick={() => saveTimecard(tc.id)}
                              disabled={saving === tc.id}
                              className={`px-2 py-1 rounded text-xs ${
                                saving === tc.id
                                  ? 'bg-gray-300 text-gray-500'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              {saving === tc.id ? '保存中' : '保存'}
                            </button>
                            <button
                              onClick={() => toggleEdit(tc.id)}
                              className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-700 hover:bg-gray-300"
                            >
                              キャンセル
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => toggleEdit(tc.id)}
                              className="px-2 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-700"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => deleteTimecard(tc.id, tc.userName)}
                              disabled={deleting === tc.id}
                              className={`px-2 py-1 rounded text-xs ${
                                deleting === tc.id
                                  ? 'bg-gray-300 text-gray-500'
                                  : 'bg-red-600 text-white hover:bg-red-700'
                              }`}
                            >
                              {deleting === tc.id ? '削除中' : '削除'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 text-sm text-gray-600">
          <p>※ 編集ボタンで出勤・退勤時刻、休憩時間、時給を変更できます</p>
          <p>※ 退勤時刻を変更すると労働時間と給与が自動で再計算されます</p>
        </div>
      </div>
    </div>
  );
}
