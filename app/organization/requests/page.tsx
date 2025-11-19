'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function OrganizationRequestsPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile || !userProfile.currentOrganizationId) return;
    const orgId = userProfile.currentOrganizationId;
    if (!orgId) return;
    const fetchRequests = async () => {
      setLoading(true);
      const snap = await getDocs(collection(db, 'organizations', orgId, 'requests'));
      const reqs = [];
      for (const r of snap.docs) {
        const data = r.data();
        let userInfo = null;
        try {
          const userSnap = await getDoc(doc(db, 'users', data.userRef));
          userInfo = userSnap.exists() ? userSnap.data() : null;
        } catch {}
        reqs.push({ id: r.id, ...data, userInfo });
      }
      setRequests(reqs);
      setLoading(false);
    };
    fetchRequests();
  }, [userProfile]);

  const handleApprove = async (req: any) => {
    // 承認: userコレクションのorganizationIdsリストに追加
    const orgId = userProfile?.currentOrganizationId;
    if (!orgId || !req.userRef) return;
    try {
      const userDocRef = doc(db, 'users', req.userRef);
      const userSnap = await getDoc(userDocRef);
      if (!userSnap.exists()) throw new Error('ユーザー情報が見つかりません');
      const orgIds = userSnap.data().organizationIds || [];
      await updateDoc(userDocRef, {
        organizationIds: Array.from(new Set([...orgIds, orgId])),
        currentOrganizationId: orgId,
      });
      await deleteDoc(doc(db, 'organizations', orgId, 'requests', req.id));
      setRequests(requests.filter(r => r.id !== req.id));
      alert('承認しました');
    } catch (e: any) {
      alert('承認に失敗しました: ' + (e?.message || ''));
    }
  };

  const handleDelete = async (req: any) => {
    const orgId = userProfile?.currentOrganizationId;
    if (!orgId || !req.id) return;
    try {
      await deleteDoc(doc(db, 'organizations', orgId, 'requests', req.id));
      setRequests(requests.filter(r => r.id !== req.id));
      alert('申請を削除しました');
    } catch (e: any) {
      alert('削除に失敗しました: ' + (e?.message || ''));
    }
  };

  if (!userProfile) return null;
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">申請一覧</h2>
          <button onClick={() => router.push('/dashboard/company')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>
        {loading ? (
          <p>読み込み中...</p>
        ) : requests.length === 0 ? (
          <p>申請はありません</p>
        ) : (
          <table className="w-full bg-white rounded shadow">
            <thead>
              <tr>
                <th className="p-2 border-b">ユーザー名</th>
                <th className="p-2 border-b">メール</th>
                <th className="p-2 border-b">申請日時</th>
                <th className="p-2 border-b">操作</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <tr key={req.id}>
                  <td className="p-2 border-b">{req.userInfo?.displayName || req.userRef}</td>
                  <td className="p-2 border-b">{req.userInfo?.email || '-'}</td>
                  <td className="p-2 border-b">{req.createdAt?.toDate?.().toLocaleString?.() ?? ''}</td>
                  <td className="p-2 border-b">
                    <button className="px-3 py-1 bg-emerald-600 text-white rounded mr-2" onClick={() => handleApprove(req)}>承認</button>
                    <button className="px-3 py-1 bg-gray-400 text-white rounded" onClick={() => handleDelete(req)}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
