'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { collection, doc, getDoc, query, where, Timestamp, setDoc, updateDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// 休憩期間の型
interface BreakPeriod {
  startAt: Timestamp;
  endAt?: Timestamp;
}

interface TimecardRecord {
  id: string;
  dateKey: string;
  organizationId: string;
  userId: string;
  clockInAt?: Timestamp;
  breaks: BreakPeriod[]; // 複数休憩対応（最大5回）
  clockOutAt?: Timestamp;
  hourlyWage?: number;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

const MAX_BREAKS = 5; // 休憩回数の上限

export default function CompanyTimecardPage() {
  const { userProfile, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const userId = params?.userId as string;

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<TimecardRecord | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [userName, setUserName] = useState<string>('');

  // live clock
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ユーザー名を取得
  useEffect(() => {
    const fetchUserName = async () => {
      if (!userId) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
          setUserName(userDoc.data().displayName || userId);
        }
      } catch (e) {
        console.error('[CompanyTimecard] Error fetching user name:', e);
      }
    };
    fetchUserName();
  }, [userId]);

  // fetch today's record
  useEffect(() => {
    const load = async () => {
      if (!userProfile?.currentOrganizationId || !userId) {
        setLoading(false);
        return;
      }
      const dateKey = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
      const q = query(
        collection(db, 'timecards'),
        where('organizationId', '==', userProfile.currentOrganizationId),
        where('userId', '==', userId),
        where('dateKey', '==', dateKey)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = d.data();
        setRecord({
          id: d.id,
          dateKey: data.dateKey,
          organizationId: data.organizationId,
          userId: data.userId,
          clockInAt: data.clockInAt,
          breaks: data.breaks || [], // 配列がない場合は空配列
          clockOutAt: data.clockOutAt,
          hourlyWage: data.hourlyWage,
          status: data.status || 'draft',
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        });
      }
      setLoading(false);
    };
    load();
  }, [userProfile?.currentOrganizationId, userId]);

  const ensureRecord = async (): Promise<TimecardRecord> => {
    if (record) return record;
    if (!userProfile?.currentOrganizationId || !userId) {
      throw new Error('ユーザー情報がありません');
    }
    const dateKey = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');

    // 時給を取得
    let wage = 1100;
    try {
      const memRef = doc(db, 'organizations', userProfile.currentOrganizationId, 'members', userId);
      const memSnap = await getDoc(memRef);
      if (memSnap.exists()) {
        const hw = memSnap.data()?.hourlyWage;
        const num = typeof hw === 'string' ? parseInt(hw, 10) : Number(hw);
        if (num && !Number.isNaN(num) && num > 0) {
          wage = num;
        }
      }
      if (wage === 1100) {
        const orgSnap = await getDoc(doc(db, 'organizations', userProfile.currentOrganizationId));
        if (orgSnap.exists()) {
          const dw = orgSnap.data()?.defaultHourlyWage;
          const num = typeof dw === 'string' ? parseInt(dw, 10) : Number(dw);
          if (num && !Number.isNaN(num) && num > 0) {
            wage = num;
          }
        }
      }
    } catch (e: any) {
      console.error('[CompanyTimecard] Error resolving wage:', e);
    }

    const ref = doc(collection(db, 'timecards'));
    const base: TimecardRecord = {
      id: ref.id,
      dateKey,
      organizationId: userProfile.currentOrganizationId,
      userId: userId,
      breaks: [],
      hourlyWage: wage,
      status: 'draft',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };
    await setDoc(ref, base);
    setRecord(base);
    return base;
  };

  // 出勤打刻
  const clockIn = async () => {
    try {
      const rec = await ensureRecord();
      if (rec.clockInAt) return;
      const ref = doc(db, 'timecards', rec.id);
      const patch = { clockInAt: Timestamp.now(), updatedAt: Timestamp.now() };
      await updateDoc(ref, patch);
      setRecord({ ...rec, ...patch });
    } catch (e) {
      console.error('[CompanyTimecard] clockIn error', e);
      alert('出勤打刻に失敗しました');
    }
  };

  // 休憩開始
  const breakStart = async () => {
    try {
      const rec = await ensureRecord();
      if (!rec.clockInAt || rec.clockOutAt) return;

      const lastBreak = rec.breaks[rec.breaks.length - 1];
      if (lastBreak && !lastBreak.endAt) return;

      if (rec.breaks.length >= MAX_BREAKS) {
        alert(`休憩は最大${MAX_BREAKS}回までです`);
        return;
      }

      const newBreak: BreakPeriod = { startAt: Timestamp.now() };
      const updatedBreaks = [...rec.breaks, newBreak];

      const ref = doc(db, 'timecards', rec.id);
      const patch = { breaks: updatedBreaks, updatedAt: Timestamp.now() };
      await updateDoc(ref, patch);
      setRecord({ ...rec, breaks: updatedBreaks, updatedAt: Timestamp.now() });
    } catch (e) {
      console.error('[CompanyTimecard] breakStart error', e);
      alert('休憩開始に失敗しました');
    }
  };

  // 休憩終了
  const breakEnd = async () => {
    try {
      const rec = await ensureRecord();
      if (rec.breaks.length === 0) return;

      const lastBreak = rec.breaks[rec.breaks.length - 1];
      if (!lastBreak || lastBreak.endAt) return;

      const updatedBreaks = rec.breaks.map((b, i) =>
        i === rec.breaks.length - 1 ? { ...b, endAt: Timestamp.now() } : b
      );

      const ref = doc(db, 'timecards', rec.id);
      const patch = { breaks: updatedBreaks, updatedAt: Timestamp.now() };
      await updateDoc(ref, patch);
      setRecord({ ...rec, breaks: updatedBreaks, updatedAt: Timestamp.now() });
    } catch (e) {
      console.error('[CompanyTimecard] breakEnd error', e);
      alert('休憩終了に失敗しました');
    }
  };

  // 退勤打刻
  const clockOut = async () => {
    try {
      const rec = await ensureRecord();
      if (!rec.clockInAt || rec.clockOutAt) return;

      const lastBreak = rec.breaks[rec.breaks.length - 1];
      if (lastBreak && !lastBreak.endAt) {
        alert('休憩を終了してから退勤してください');
        return;
      }

      const ref = doc(db, 'timecards', rec.id);
      const patch = { clockOutAt: Timestamp.now(), updatedAt: Timestamp.now() };
      await updateDoc(ref, patch);
      setRecord({ ...rec, ...patch });
    } catch (e) {
      console.error('[CompanyTimecard] clockOut error', e);
      alert('退勤打刻に失敗しました');
    }
  };

  // ボタン有効/無効の判定
  const canClockIn = useMemo(() => !record?.clockInAt, [record]);

  const canBreakStart = useMemo(() => {
    if (!record?.clockInAt || record?.clockOutAt) return false;
    if (record.breaks.length >= MAX_BREAKS) return false;
    const lastBreak = record.breaks[record.breaks.length - 1];
    return !lastBreak || !!lastBreak.endAt;
  }, [record]);

  const canBreakEnd = useMemo(() => {
    if (!record?.clockInAt || record?.clockOutAt) return false;
    if (record.breaks.length === 0) return false;
    const lastBreak = record.breaks[record.breaks.length - 1];
    return lastBreak && !lastBreak.endAt;
  }, [record]);

  const canClockOut = useMemo(() => {
    if (!record?.clockInAt || record?.clockOutAt) return false;
    const lastBreak = record.breaks[record.breaks.length - 1];
    return !lastBreak || !!lastBreak.endAt;
  }, [record]);

  // 勤務時間の計算
  const workedMinutes = useMemo(() => {
    if (!record?.clockInAt || !now) return 0;
    const end = record.clockOutAt ? record.clockOutAt.toDate() : now;
    return Math.floor((end.getTime() - record.clockInAt.toDate().getTime()) / 60000);
  }, [record, now]);

  // 休憩時間の合計計算
  const breakMinutes = useMemo(() => {
    if (!record || record.breaks.length === 0 || !now) return 0;
    let total = 0;
    for (const b of record.breaks) {
      const start = b.startAt.toDate();
      let end: Date;
      if (b.endAt) {
        end = b.endAt.toDate();
      } else if (record.clockOutAt) {
        continue;
      } else {
        end = now;
      }
      total += Math.floor((end.getTime() - start.getTime()) / 60000);
    }
    return total;
  }, [record, now]);

  const netMinutes = workedMinutes - breakMinutes;
  const hours = Math.floor(netMinutes / 60);
  const minutes = netMinutes % 60;

  const isOnBreak = useMemo(() => {
    if (!record || record.breaks.length === 0) return false;
    const lastBreak = record.breaks[record.breaks.length - 1];
    return lastBreak && !lastBreak.endAt;
  }, [record]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">読み込み中...</div>
      </div>
    );
  }

  if (!userProfile || !userId) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold">{userName}のタイムカード</h1>
            <button
              onClick={() => router.back()}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              ← 戻る
            </button>
          </div>
          <div className="text-center">
            <div className="text-5xl font-mono font-bold text-blue-600">
              {now?.toLocaleTimeString('ja-JP') || '--:--:--'}
            </div>
            <div className="text-gray-600 mt-2">
              {now?.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
              })}
            </div>
          </div>
        </div>

        {/* 打刻ボタン */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={clockIn}
            disabled={!canClockIn}
            className={`py-8 rounded-lg text-white font-bold text-lg transition-all ${
              canClockIn
                ? 'bg-green-600 hover:bg-green-700 active:scale-95'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            出勤
          </button>
          <button
            onClick={clockOut}
            disabled={!canClockOut}
            className={`py-8 rounded-lg text-white font-bold text-lg transition-all ${
              canClockOut
                ? 'bg-red-600 hover:bg-red-700 active:scale-95'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            退勤
          </button>
          <button
            onClick={breakStart}
            disabled={!canBreakStart}
            className={`py-8 rounded-lg text-white font-bold text-lg transition-all ${
              canBreakStart
                ? 'bg-yellow-600 hover:bg-yellow-700 active:scale-95'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            休憩開始 {record && record.breaks.length > 0 && `(${record.breaks.length}/${MAX_BREAKS})`}
          </button>
          <button
            onClick={breakEnd}
            disabled={!canBreakEnd}
            className={`py-8 rounded-lg text-white font-bold text-lg transition-all ${
              canBreakEnd
                ? 'bg-blue-600 hover:bg-blue-700 active:scale-95'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            休憩終了
          </button>
        </div>

        {/* タイムカード情報 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold mb-4">本日の記録</h2>
          <div className="space-y-3">
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">出勤時刻</span>
              <span className="font-mono font-bold">
                {record?.clockInAt
                  ? record.clockInAt.toDate().toLocaleTimeString('ja-JP')
                  : '未打刻'}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">退勤時刻</span>
              <span className="font-mono font-bold">
                {record?.clockOutAt
                  ? record.clockOutAt.toDate().toLocaleTimeString('ja-JP')
                  : '未打刻'}
              </span>
            </div>

            {/* 休憩時間リスト */}
            <div className="border-b pb-2">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">休憩記録</span>
                <span className="text-sm text-gray-500">
                  {record?.breaks.length || 0}/{MAX_BREAKS}回
                </span>
              </div>
              {record && record.breaks.length > 0 ? (
                <div className="ml-4 space-y-1">
                  {record.breaks.map((b, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-gray-500">#{idx + 1}</span>
                      <span className="font-mono">
                        {b.startAt.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                        {' → '}
                        {b.endAt
                          ? b.endAt.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
                          : <span className="text-yellow-600">休憩中...</span>
                        }
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ml-4 text-sm text-gray-400">休憩なし</div>
              )}
            </div>

            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">勤務時間</span>
              <span className="font-mono font-bold text-blue-600">
                {hours}時間 {minutes}分
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">休憩時間（合計）</span>
              <span className={`font-mono font-bold text-yellow-600`}>
                {Math.floor(breakMinutes / 60)}時間 {breakMinutes % 60}分
                {isOnBreak && ' (休憩中)'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}