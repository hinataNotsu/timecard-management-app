'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { collection, doc, getDoc, query, where, Timestamp, setDoc, updateDoc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface TimecardRecord {
  id: string;
  dateKey: string; // YYYY-MM-DD
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

export default function TimecardPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<TimecardRecord | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [isWatchAdmin, setIsWatchAdmin] = useState<boolean | null>(null);

  // live clock
  useEffect(() => {
    // 初回マウント時に現在時刻を設定し、その後は1秒ごとに更新
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 組織設定のisWatchAdminをチェック
  useEffect(() => {
    const checkOrgSettings = async () => {
      if (!userProfile?.currentOrganizationId) return;
      try {
        const orgDoc = await getDoc(doc(db, 'organizations', userProfile.currentOrganizationId));
        if (orgDoc.exists()) {
          const orgData = orgDoc.data();
          const watchAdmin = orgData.isWatchAdmin !== false; // デフォルトtrue
          setIsWatchAdmin(watchAdmin);
        }
      } catch (error) {
        console.error('[Timecard] Error checking org settings:', error);
      }
    };
    checkOrgSettings();
  }, [userProfile?.currentOrganizationId]);

  // access control
  useEffect(() => {
    if (!userProfile) return;
    
    // isWatchAdminの読み込みが完了するまで待つ
    if (isWatchAdmin === null) return;
    
    // isWatchAdminがtrueの場合、アルバイトはタイムカードにアクセスできない
    // ただし管理者(isManage=true)は除外
    if (isWatchAdmin === true && !userProfile.isManage) {
      router.push('/dashboard/part-time');
    }
  }, [userProfile, isWatchAdmin, router]);

  const dateKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  // load today's latest incomplete timecard
  useEffect(() => {
    const load = async () => {
      if (!userProfile?.uid || !userProfile.currentOrganizationId) return;
      setLoading(true);
      try {
        const qy = query(
          collection(db, 'timecards'),
          where('organizationId', '==', userProfile.currentOrganizationId),
          where('userId', '==', userProfile.uid),
          where('dateKey', '==', dateKey)
        );
        const snap = await getDocs(qy);
        // 最新の未完了タイムカード（clockOutAtがないもの）を優先、なければ最新のもの
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as TimecardRecord));
        const incomplete = docs.find(d => !d.clockOutAt);
        if (incomplete) {
          setRecord(incomplete);
        } else if (docs.length > 0) {
          // 全て完了している場合は最新のものを表示（createdAtでソート）
          const sorted = docs.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
          setRecord(sorted[0]);
        }
      } catch (e: any) {
        console.error('[Timecard] load error', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userProfile?.uid, userProfile?.currentOrganizationId, dateKey]);

  const ensureRecord = async (): Promise<TimecardRecord> => {
    if (record && !record.clockOutAt) {
      console.debug('[Timecard][ensureRecord] Reuse existing draft', {
        id: record.id,
        hourlyWage: (record as any)?.hourlyWage,
        clockInAt: (record as any)?.clockInAt?.toDate?.()?.toISOString?.(),
        clockOutAt: (record as any)?.clockOutAt?.toDate?.()?.toISOString?.(),
      });
      return record; // 未完了のタイムカードがあればそれを使う
    }
    if (!userProfile?.uid || !userProfile.currentOrganizationId) throw new Error('missing user/org');
    console.debug('[Timecard][ensureRecord] Resolve hourlyWage start', {
      uid: userProfile.uid,
      orgId: userProfile.currentOrganizationId,
    });
    // ユーザー別時給取得（なければ組織デフォルト）
    let wage: number | undefined;
    let debugSource: 'member' | 'org' | 'fallback' = 'fallback';
    try {
      const memberPath = ['organizations', userProfile.currentOrganizationId, 'members', userProfile.uid].join('/');
      console.debug('[Timecard][ensureRecord] Read member doc', { path: memberPath });
      const memberSnap = await getDoc(doc(db, 'organizations', userProfile.currentOrganizationId, 'members', userProfile.uid));
      if (memberSnap.exists()) {
        const raw = memberSnap.data() as any;
        const w = raw?.hourlyWage;
        const num = typeof w === 'number' ? w : Number(w);
        console.debug('[Timecard][ensureRecord] Member wage', { raw: w, parsed: num });
        if (num && !Number.isNaN(num) && num > 0) {
          wage = num;
          debugSource = 'member';
        }
      }
      if (!wage) {
        const orgPath = ['organizations', userProfile.currentOrganizationId].join('/');
        console.debug('[Timecard][ensureRecord] Read org doc', { path: orgPath });
        const orgSnap = await getDoc(doc(db, 'organizations', userProfile.currentOrganizationId));
        if (orgSnap.exists()) {
          const d = orgSnap.data() as any;
          const dw = d?.defaultHourlyWage;
          const num = typeof dw === 'number' ? dw : Number(dw);
          console.debug('[Timecard][ensureRecord] Org default wage', { raw: dw, parsed: num });
          if (num && !Number.isNaN(num) && num > 0) {
            wage = num;
            debugSource = 'org';
          }
        } else {
          console.debug('[Timecard][ensureRecord] Org doc not found');
        }
      }
    } catch (e: any) {
      console.error('[Timecard][ensureRecord] Error resolving wage, fallback to 1100', e);
      wage = 1100;
      debugSource = 'fallback';
    }
    if (!wage) { wage = 1100; debugSource = 'fallback'; }
    console.debug('[Timecard][ensureRecord] Resolved hourlyWage', { wage, source: debugSource });
    const ref = doc(collection(db, 'timecards'));
    const base: TimecardRecord = {
      id: ref.id,
      dateKey,
      organizationId: userProfile.currentOrganizationId,
      userId: userProfile.uid,
      hourlyWage: wage,
      status: 'draft',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };
    console.debug('[Timecard][ensureRecord] Creating new timecard', { id: ref.id, hourlyWage: wage, source: debugSource });
    await setDoc(ref, base);
    setRecord(base);
    return base;
  };

  const updateField = async (field: keyof Omit<TimecardRecord,'id'|'dateKey'|'organizationId'|'userId'|'createdAt'|'updatedAt'>) => {
    try {
      const rec = await ensureRecord();
      if (rec[field]) return; // already set
      const ref = doc(db, 'timecards', rec.id);
      const patch: any = { [field]: Timestamp.now(), updatedAt: Timestamp.now() };
      await updateDoc(ref, patch);
      const next = { ...rec, ...patch } as TimecardRecord;
      setRecord(next);
    } catch (e) {
      console.error('[Timecard] update error', e);
      alert('打刻に失敗しました');
    }
  };

  // derived durations
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

  const clockIn = () => updateField('clockInAt');
  const breakStart = () => updateField('breakStartAt');
  const breakEnd = () => updateField('breakEndAt');
  const clockOut = () => updateField('clockOutAt');

  const canClockIn = useMemo(() => !record?.clockInAt, [record]);
  const canBreakStart = useMemo(() => record?.clockInAt && !record?.breakStartAt && !record?.clockOutAt, [record]);
  const canBreakEnd = useMemo(() => record?.breakStartAt && !record?.breakEndAt && !record?.clockOutAt, [record]);
  const canClockOut = useMemo(() => record?.clockInAt && !record?.clockOutAt && (!record?.breakStartAt || record?.breakEndAt), [record]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">読み込み中...</div>
      </div>
    );
  }

  if (!userProfile) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold">{userProfile.displayName}のタイムカード</h1>
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
            <div className="flex justify-between">
              <span className="text-gray-600">休憩時間</span>
              <span className="font-mono font-bold text-yellow-600">
                {Math.floor(breakMinutes / 60)}時間 {breakMinutes % 60}分
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
