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
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export default function TimecardPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<TimecardRecord | null>(null);
  const [now, setNow] = useState<Date>(new Date());

  // live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // access control
  useEffect(() => {
    if (!userProfile) return;
    if (userProfile.isManage) {
      router.push('/dashboard/company');
    }
  }, [userProfile, router]);

  const dateKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  // load today's timecard
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
        if (!snap.empty) {
          const d = snap.docs[0];
          setRecord(d.data() as TimecardRecord);
        }
      } catch (e) {
        console.error('[Timecard] load error', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userProfile?.uid, userProfile?.currentOrganizationId, dateKey]);

  const ensureRecord = async (): Promise<TimecardRecord> => {
    if (record) return record;
    if (!userProfile?.uid || !userProfile.currentOrganizationId) throw new Error('missing user/org');
    const ref = doc(collection(db, 'timecards'));
    const base: TimecardRecord = {
      id: ref.id,
      dateKey,
      organizationId: userProfile.currentOrganizationId,
      userId: userProfile.uid,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">タイムカード</h1>
          <button onClick={() => router.push('/dashboard/part-time')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center justify-between">
          <div className="text-gray-700 font-medium">{dateKey}</div>
          <div className="font-mono text-lg">{now.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-3">打刻状況</h2>
            {loading && !record ? (
              <p className="text-gray-500">読み込み中...</p>
            ) : (
              <ul className="space-y-2 text-sm">
                <li><span className="inline-block w-24 text-gray-600">出勤:</span> {fmt(record?.clockInAt)}</li>
                <li><span className="inline-block w-24 text-gray-600">休憩開始:</span> {fmt(record?.breakStartAt)}</li>
                <li><span className="inline-block w-24 text-gray-600">休憩終了:</span> {fmt(record?.breakEndAt)}</li>
                <li><span className="inline-block w-24 text-gray-600">退勤:</span> {fmt(record?.clockOutAt)}</li>
              </ul>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button disabled={!canClockIn} onClick={() => updateField('clockInAt')} className={`px-3 py-2 rounded text-white text-sm ${canClockIn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-300 cursor-not-allowed'}`}>出勤</button>
              <button disabled={!canClockOut} onClick={() => updateField('clockOutAt')} className={`px-3 py-2 rounded text-white text-sm ${canClockOut ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-300 cursor-not-allowed'}`}>退勤</button>
              <button disabled={!canBreakStart} onClick={() => updateField('breakStartAt')} className={`px-3 py-2 rounded text-white text-sm ${canBreakStart ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-300 cursor-not-allowed'}`}>休憩開始</button>
              <button disabled={!canBreakEnd} onClick={() => updateField('breakEndAt')} className={`px-3 py-2 rounded text-white text-sm ${canBreakEnd ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'}`}>休憩終了</button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-3">集計</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">総労働時間(分)</span><span className="font-medium">{workedMinutes}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">休憩時間(分)</span><span className="font-medium">{breakMinutes}</span></div>
            </div>
            <p className="mt-4 text-xs text-gray-500">※ 一度打刻した項目は修正できません（将来編集機能追加予定）。</p>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm text-yellow-800">
          給与計算をタイムカードベースに切り替えるには、既存のシフト登録ロジックとの統合が必要です。次のステップとして自動シフト生成または計算時にタイムカードを参照する処理を追加できます。
        </div>
      </div>
    </div>
  );
}
