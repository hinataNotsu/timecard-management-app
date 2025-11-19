'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, updateDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
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
      const orgDocRef = doc(db, 'organizations', orgId);
      const orgDoc = await getDoc(orgDocRef);
      const orgData = orgDoc.exists() ? orgDoc.data() : {};
      const permissionList = Array.isArray(orgData.permissionList) ? orgData.permissionList : [];
      console.log('[Requests] Loaded permissionList:', permissionList);
      setRequests(permissionList);
      setLoading(false);
    };
    fetchRequests();
  }, [userProfile]);

  const handleApprove = async (req: any) => {
    const orgId = userProfile?.currentOrganizationId;
    if (!orgId || !req.uid) return;
    try {
      // ユーザーのorganizationIdsに追加
      const userRef = doc(db, 'users', req.uid);
      await updateDoc(userRef, {
        organizationIds: arrayUnion(orgId),
        currentOrganizationId: orgId,
      });
      // permissionListから申請データを削除
      const orgDocRef = doc(db, 'organizations', orgId);
      const orgDoc = await getDoc(orgDocRef);
      const orgData = orgDoc.exists() ? orgDoc.data() : {};
      const permissionList = Array.isArray(orgData.permissionList) ? orgData.permissionList : [];
      const newList = permissionList.filter((p: any) => p.uid !== req.uid);
      await updateDoc(orgDocRef, { permissionList: newList });
      setRequests((prev) => prev.filter((r) => r.uid !== req.uid));
      alert('申請を承認しました');
    } catch (e) {
      console.error('[Requests] approve error', e);
      alert('申請の承認に失敗しました');
    }
  };

  const handleDelete = async (req: any) => {
    const orgId = userProfile?.currentOrganizationId;
    if (!orgId || !req.uid) return;
    try {
      // permissionListから申請データを削除
      const orgDocRef = doc(db, 'organizations', orgId);
      const orgDoc = await getDoc(orgDocRef);
      const orgData = orgDoc.exists() ? orgDoc.data() : {};
      const permissionList = Array.isArray(orgData.permissionList) ? orgData.permissionList : [];
      const newList = permissionList.filter((p: any) => p.uid !== req.uid);
      await updateDoc(orgDocRef, { permissionList: newList });
      setRequests((prev) => prev.filter((r) => r.uid !== req.uid));
      alert('申請を削除しました');
    } catch (e) {
      console.error('[Requests] reject error', e);
      alert('申請の削除に失敗しました');
    }
  };

  if (!userProfile) return null;
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="w-full md:w-3/5 mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl md:text-2xl font-bold">申請一覧</h2>
          <button onClick={() => router.push('/dashboard/company')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>
        {loading ? (
          <p>読み込み中...</p>
        ) : requests.length === 0 ? (
          <p>申請はありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full bg-white rounded shadow">
              <thead>
                <tr>
                  <th className="p-2 border-b text-center text-sm md:text-base">ユーザー名</th>
                  <th className="p-2 border-b text-center text-sm md:text-base hidden md:table-cell">メール</th>
                  <th className="p-2 border-b text-center text-sm md:text-base hidden sm:table-cell">申請日時</th>
                  <th className="p-2 border-b text-center text-sm md:text-base">操作</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <tr key={req.uid}>
                    <td className="p-2 border-b text-center text-sm md:text-base">{req.displayName || req.email || req.uid}</td>
                    <td className="p-2 border-b text-center text-sm md:text-base hidden md:table-cell">{req.email || '-'}</td>
                    <td className="p-2 border-b text-center text-sm md:text-base hidden sm:table-cell">{req.createdAt?.toDate?.() ? req.createdAt.toDate().toLocaleString() : ''}</td>
                    <td className="p-2 border-b text-center">
                      <div className="flex flex-col sm:flex-row gap-2 justify-center">
                        <button className="px-3 py-1 bg-emerald-600 text-white rounded text-sm md:text-base" onClick={() => handleApprove(req)}>承認</button>
                        <button className="px-3 py-1 bg-gray-400 text-white rounded text-sm md:text-base" onClick={() => handleDelete(req)}>削除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
