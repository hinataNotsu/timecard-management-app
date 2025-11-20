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
    if (!record?.clockInAt || !record.clockOutAt) return 0;
    const start = record.clockInAt.toDate();
    const end = record.clockOutAt.toDate();
    let diff = Math.max(0, (end.getTime() - start.getTime()) / 60000);
    if (record.breakStartAt && record.breakEndAt) {
      const bs = record.breakStartAt.toDate();
      const be = record.breakEndAt.toDate();
      const bd = Math.max(0, (be.getTime() - bs.getTime()) / 60000);
      diff -= bd;
    }
    return Math.round(diff);
  }, [record]);

  const breakMinutes = useMemo(() => {
    if (!record?.breakStartAt || !record.breakEndAt) return 0;
    const bs = record.breakStartAt.toDate();
    const be = record.breakEndAt.toDate();
    return Math.round(Math.max(0, (be.getTime() - bs.getTime()) / 60000));
  }, [record]);

  const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '--:--:--';

  // button states
  const canClockIn = !record?.clockInAt;
  const canBreakStart = !!record?.clockInAt && !record.breakStartAt && !record.clockOutAt;
  const canBreakEnd = !!record?.breakStartAt && !record.breakEndAt && !record.clockOutAt;
  const canClockOut = !!record?.clockInAt && !record.clockOutAt && (!record.breakStartAt || !!record.breakEndAt);
  const canStartNew = !!record?.clockOutAt; // 退勤済みなら新しいタイムカードを開始できる

  const startNewTimecard = () => {
    setRecord(null); // レコードをクリアして新しいタイムカードを作成可能にする
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">タイムカード</h1>
          <button onClick={() => router.push('/dashboard/part-time')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center justify-between">
          <div className="text-gray-700 font-medium">{dateKey}</div>
          <div className="font-mono text-lg" suppressHydrationWarning>
            {now ? now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}
          </div>
        </div>

        <div className="flex justify-center mb-8">
          <div className="bg-white rounded-lg shadow p-4 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-3">打刻状況</h2>
            {loading && !record ? (
              <p className="text-gray-500">読み込み中...</p>
            ) : (
              <>
                <ul className="space-y-2 text-sm mb-4">
                  <li><span className="inline-block w-24 text-gray-600">出勤:</span> {fmt(record?.clockInAt)}</li>
                  <li><span className="inline-block w-24 text-gray-600">休憩開始:</span> {fmt(record?.breakStartAt)}</li>
                  <li><span className="inline-block w-24 text-gray-600">休憩終了:</span> {fmt(record?.breakEndAt)}</li>
                  <li><span className="inline-block w-24 text-gray-600">退勤:</span> {fmt(record?.clockOutAt)}</li>
                  <li className="border-t pt-2"><span className="inline-block w-24 text-gray-600">総労働:</span> <span className="font-medium">{workedMinutes}分</span></li>
                  <li><span className="inline-block w-24 text-gray-600">休憩時間:</span> <span className="font-medium">{breakMinutes}分</span></li>
                </ul>
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button disabled={!canClockIn} onClick={() => updateField('clockInAt')} className={`px-3 py-2 rounded text-white text-sm ${canClockIn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300 cursor-not-allowed'}`}>出勤</button>
              <button disabled={!canClockOut} onClick={() => updateField('clockOutAt')} className={`px-3 py-2 rounded text-white text-sm ${canClockOut ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-300 cursor-not-allowed'}`}>退勤</button>
              <button disabled={!canBreakStart} onClick={() => updateField('breakStartAt')} className={`px-3 py-2 rounded text-white text-sm ${canBreakStart ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-300 cursor-not-allowed'}`}>休憩開始</button>
              <button disabled={!canBreakEnd} onClick={() => updateField('breakEndAt')} className={`px-3 py-2 rounded text-white text-sm ${canBreakEnd ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'}`}>休憩終了</button>
            </div>
            {canStartNew && (
              <div className="mt-4">
                <button onClick={startNewTimecard} className="w-full px-3 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium">新しいタイムカードを開始</button>
              </div>
            )}
            <p className="mt-4 text-xs text-gray-500">※ 一度打刻した項目は修正できません（将来編集機能追加予定）。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
