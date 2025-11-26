'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, getDocs, doc, updateDoc, deleteDoc, Timestamp, orderBy, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/components/Toast';

// 休憩期間の型定義
interface BreakPeriod {
  startAt: Timestamp;
  endAt?: Timestamp;
}

interface TimecardRow {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  dateKey: string;
  date: Timestamp;
  clockIn?: Timestamp;
  clockOut?: Timestamp;
  breaks: BreakPeriod[];  // 複数休憩対応
  breakTime: number; // 合計休憩時間（分）- 表示用
  hourlyWage: number;
  status: 'in_progress' | 'completed';
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  totalHours?: number;
  totalPay?: number;
  isEditing?: boolean;
}

// ドロップダウンメニュー位置
interface MenuPosition {
  top: number;
  left: number;
}

// 休憩時間合計を計算するヘルパー関数
const calcTotalBreakMinutes = (breaks: BreakPeriod[]): number => {
  if (!breaks || breaks.length === 0) return 0;
  let total = 0;
  for (const b of breaks) {
    if (b.startAt && b.endAt) {
      total += Math.max(0, Math.floor((b.endAt.toMillis() - b.startAt.toMillis()) / 60000));
    }
  }
  return total;
};

export default function TimecardsPage() {
  const { userProfile, loading } = useAuth();
  const router = useRouter();
  const [timecards, setTimecards] = useState<TimecardRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const { showSuccessToast, showErrorToast, showConfirmToast } = useToast();
  
  // ドロップダウンメニュー状態
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  
  // 休憩詳細モーダル
  const [breakDetailCardId, setBreakDetailCardId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!userProfile || !userProfile.isManage)) {
      router.push('/staff/dashboard');
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
          
          // 複数休憩対応: breaks配列から合計時間を計算
          const breaks: BreakPeriod[] = r.breaks || [];
          const breakMinutes = calcTotalBreakMinutes(breaks);
          
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
            breaks,
            breakTime: breakMinutes,
            hourlyWage: Number(r.hourlyWage ?? 0),
            status,
            approvalStatus: r.status || 'draft',
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
        hourlyWage: timecard.hourlyWage,
        updatedAt: Timestamp.now(),
      };

      // 出勤・退勤時刻の更新
      if (timecard.clockIn) updateData.clockInAt = timecard.clockIn;
      if (timecard.clockOut) updateData.clockOutAt = timecard.clockOut;

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

      showSuccessToast('保存しました');
    } catch (error) {
      console.error('[Timecards] Error saving timecard:', error);
      showErrorToast('保存に失敗しました');
    } finally {
      setSaving(null);
    }
  };

  const deleteTimecard = async (id: string, userName: string) => {
    const confirmed = await showConfirmToast(`${userName}のタイムカードを削除しますか？`, {
      title: 'タイムカードの削除',
      confirmText: '削除',
      cancelText: 'キャンセル',
    });
    if (!confirmed) return;
    setDeleting(id);
    try {
      await deleteDoc(doc(db, 'timecards', id));
      setTimecards(prev => prev.filter(tc => tc.id !== id));
      showSuccessToast('削除しました');
    } catch (error) {
      console.error('[Timecards] Error deleting timecard:', error);
      showErrorToast('削除に失敗しました');
    } finally {
      setDeleting(null);
    }
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

  // 休憩詳細モーダル用のデータ
  const breakDetailCard = breakDetailCardId ? timecards.find(tc => tc.id === breakDetailCardId) : null;

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
            onClick={() => router.push('/company/dashboard')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← ダッシュボード
          </button>
        </div>

        <div className="bg-white rounded-lg shadow overflow-visible">
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
                      {tc.breaks.length > 0 ? (
                        <button
                          onClick={() => setBreakDetailCardId(tc.id)}
                          className="text-blue-600 hover:underline"
                          title="休憩詳細を表示"
                        >
                          {tc.breakTime}分 ({tc.breaks.length}回)
                        </button>
                      ) : (
                        <span className="text-gray-400">-</span>
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
                        {tc.approvalStatus === 'approved' ? (
                          <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-500">
                            承認済
                          </span>
                        ) : tc.isEditing ? (
                          <>
                            <button
                              onClick={() => saveTimecard(tc.id)}
                              disabled={saving === tc.id}
                              className={`px-2 py-1 rounded text-xs ${
                                saving === tc.id
                                  ? 'bg-gray-200 text-gray-500'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              {saving === tc.id ? '保存中...' : '保存'}
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
                              className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-700 hover:bg-gray-300"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => deleteTimecard(tc.id, tc.userName)}
                              disabled={deleting === tc.id}
                              className={`px-2 py-1 rounded text-xs ${
                                deleting === tc.id
                                  ? 'bg-gray-200 text-gray-500'
                                  : 'bg-red-600 text-white hover:bg-red-700'
                              }`}
                            >
                              {deleting === tc.id ? '削除中...' : '削除'}
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
      </div>

      {/* 休憩詳細モーダル */}
      {breakDetailCard && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setBreakDetailCardId(null)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-bold">休憩詳細</h3>
              <button
                onClick={() => setBreakDetailCardId(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <p className="text-sm text-gray-600">
                  {breakDetailCard.userName} - {formatDate(breakDetailCard.date)}
                </p>
              </div>
              
              {breakDetailCard.breaks.length === 0 ? (
                <p className="text-gray-500 text-center py-4">休憩記録がありません</p>
              ) : (
                <div className="space-y-3">
                  {breakDetailCard.breaks.map((b, idx) => {
                    const startTime = b.startAt ? formatTime(b.startAt) : '--:--';
                    const endTime = b.endAt ? formatTime(b.endAt) : '休憩中...';
                    const duration = b.startAt && b.endAt 
                      ? Math.floor((b.endAt.toMillis() - b.startAt.toMillis()) / 60000)
                      : null;
                    
                    return (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-gray-500">#{idx + 1}</span>
                          <span className="text-sm">
                            {startTime} → {endTime}
                          </span>
                        </div>
                        <span className={`text-sm font-medium ${duration !== null ? 'text-gray-900' : 'text-yellow-600'}`}>
                          {duration !== null ? `${duration}分` : '進行中'}
                        </span>
                      </div>
                    );
                  })}
                  
                  <div className="pt-3 border-t flex items-center justify-between">
                    <span className="font-medium">合計</span>
                    <span className="font-bold text-blue-600">{breakDetailCard.breakTime}分</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}