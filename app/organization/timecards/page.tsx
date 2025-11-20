'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface TimecardRecord {
  id: string;
  dateKey: string;
  organizationId: string;
  userId: string;
  clockInAt?: Timestamp;
  breakStartAt?: Timestamp;
  breakEndAt?: Timestamp;
  clockOutAt?: Timestamp;
  hourlyWage?: number;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

function TimecardPageContent() {
  const { userProfile, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = searchParams?.get('userId');
  
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<TimecardRecord | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [userName, setUserName] = useState<string>('');

  // アクセス制御
  useEffect(() => {
    if (!authLoading && !userProfile) {
      router.push('/login/company');
      return;
    }
    if (!authLoading && userProfile && !userProfile.isManage) {
      router.push('/dashboard/part-time');
      return;
    }
    if (!authLoading && !userId) {
      router.push('/organization/timecards/users');
      return;
    }
  }, [userProfile, authLoading, userId, router]);

  // ユーザー名を取得
  useEffect(() => {
    if (!userId) return;
    const fetchUserName = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserName(data.name || data.displayName || data.email || 'Unknown User');
        }
      } catch (error) {
        console.error('Error fetching user name:', error);
      }
    };
    fetchUserName();
  }, [userId]);

  // リアルタイムクロック
  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // 今日のタイムカードを取得または作成準備
  const ensureRecord = async () => {
    if (!userProfile?.currentOrganizationId || !userId) return null;

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;

    const timecardsRef = collection(db, 'timecards');
    const q = query(
      timecardsRef,
      where('organizationId', '==', userProfile.currentOrganizationId),
      where('userId', '==', userId),
      where('dateKey', '==', dateKey)
    );
    const snap = await getDocs(q);

    if (!snap.empty) {
      const docSnap = snap.docs[0];
      return { id: docSnap.id, ...docSnap.data() } as TimecardRecord;
    }

    // 時給を取得（member.hourlyWage → organization.defaultHourlyWage → fallback 1100）
    let hourlyWage = 1100;
    const orgDoc = await getDoc(doc(db, 'organizations', userProfile.currentOrganizationId));
    if (orgDoc.exists()) {
      const orgData = orgDoc.data();
      if (orgData.defaultHourlyWage) {
        hourlyWage = orgData.defaultHourlyWage;
      }
      const membersRef = collection(db, 'organizations', userProfile.currentOrganizationId, 'members');
      const memberQ = query(membersRef, where('userId', '==', userId));
      const memberSnap = await getDocs(memberQ);
      if (!memberSnap.empty) {
        const memberData = memberSnap.docs[0].data();
        if (memberData.hourlyWage) {
          hourlyWage = memberData.hourlyWage;
        }
      }
    }

    const newRecord: Omit<TimecardRecord, 'id'> = {
      dateKey,
      organizationId: userProfile.currentOrganizationId,
      userId: userId,
      status: 'draft',
      hourlyWage,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    return newRecord as TimecardRecord;
  };

  useEffect(() => {
    const load = async () => {
      if (!userProfile?.currentOrganizationId || !userId) {
        setLoading(false);
        return;
      }
      try {
        const rec = await ensureRecord();
        setRecord(rec);
      } catch (error) {
        console.error('Error loading record:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile, userId]);

  const updateField = async (field: keyof TimecardRecord, value: Timestamp | undefined) => {
    if (!userProfile?.currentOrganizationId || !userId) return;
    try {
      let rec = record;
      if (!rec || !rec.id) {
        rec = await ensureRecord();
        if (!rec) return;
      }

      const update = { [field]: value, updatedAt: Timestamp.now() };

      if (rec.id) {
        await updateDoc(doc(db, 'timecards', rec.id), update);
        setRecord({ ...rec, ...update });
      } else {
        const newDocRef = doc(collection(db, 'timecards'));
        const newRecord = { ...rec, ...update, id: newDocRef.id };
        await setDoc(newDocRef, newRecord);
        setRecord(newRecord);
      }
    } catch (error) {
      console.error('Error updating field:', error);
      alert('打刻に失敗しました。もう一度お試しください。');
    }
  };

  const clockIn = () => updateField('clockInAt', Timestamp.now());
  const breakStart = () => updateField('breakStartAt', Timestamp.now());
  const breakEnd = () => updateField('breakEndAt', Timestamp.now());
  const clockOut = () => updateField('clockOutAt', Timestamp.now());

  const canClockIn = useMemo(() => !record?.clockInAt, [record]);
  const canBreakStart = useMemo(() => record?.clockInAt && !record?.breakStartAt && !record?.clockOutAt, [record]);
  const canBreakEnd = useMemo(() => record?.breakStartAt && !record?.breakEndAt && !record?.clockOutAt, [record]);
  const canClockOut = useMemo(() => record?.clockInAt && !record?.clockOutAt && (!record?.breakStartAt || record?.breakEndAt), [record]);

  const workedMinutes = useMemo(() => {
    if (!record?.clockInAt || !now) return 0;
    const end = record.clockOutAt ? record.clockOutAt.toDate() : now;
    return Math.floor((end.getTime() - record.clockInAt.toDate().getTime()) / 60000);
  }, [record, now]);

  const breakMinutes = useMemo(() => {
    if (!record?.breakStartAt) return 0;
    const end = record.breakEndAt ? record.breakEndAt.toDate() : (record.clockOutAt ? null : now);
    if (!end) return 0;
    return Math.floor((end.getTime() - record.breakStartAt.toDate().getTime()) / 60000);
  }, [record, now]);

  const netMinutes = workedMinutes - breakMinutes;
  const hours = Math.floor(netMinutes / 60);
  const minutes = netMinutes % 60;

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
            休憩開始
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
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">休憩開始</span>
              <span className="font-mono font-bold">
                {record?.breakStartAt
                  ? record.breakStartAt.toDate().toLocaleTimeString('ja-JP')
                  : '未打刻'}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">休憩終了</span>
              <span className="font-mono font-bold">
                {record?.breakEndAt
                  ? record.breakEndAt.toDate().toLocaleTimeString('ja-JP')
                  : '未打刻'}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">勤務時間</span>
              <span className="font-mono font-bold text-blue-600">
                {hours}時間 {minutes}分
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">休憩時間</span>
              <span className="font-mono font-bold text-yellow-600">
                {Math.floor(breakMinutes / 60)}時間 {breakMinutes % 60}分
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">時給</span>
              <span className="font-mono font-bold">
                ¥{record?.hourlyWage?.toLocaleString() || '---'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TimecardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">読み込み中...</div>
      </div>
    }>
      <TimecardPageContent />
    </Suspense>
  );
}
