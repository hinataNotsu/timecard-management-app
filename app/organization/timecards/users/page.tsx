'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { User } from '@/types';

interface UserRow {
  uid: string;
  displayName: string;
  email: string;
  deleted: boolean;
}

export default function TimecardsUsersPage() {
  const { userProfile, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!loading && (!userProfile || !userProfile.isManage)) {
      router.push('/dashboard/part-time');
    }
  }, [userProfile, loading, router]);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!userProfile?.currentOrganizationId) return;
      
      setLoadingData(true);
      try {
        // organizationIdsに現在の組織IDを含むユーザーを取得
        const q = query(
          collection(db, 'users'),
          where('organizationIds', 'array-contains', userProfile.currentOrganizationId)
        );
        const snapshot = await getDocs(q);

        const userList: UserRow[] = snapshot.docs.map(doc => {
          const data = doc.data() as User;
          return {
            uid: data.uid,
            displayName: data.displayName || data.email || data.uid,
            email: data.email,
            deleted: data.deleted || false,
          };
        });

        // 削除済みユーザーを後ろに、名前順にソート
        userList.sort((a, b) => {
          if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
          return a.displayName.localeCompare(b.displayName, 'ja');
        });

        setUsers(userList);
      } catch (error) {
        console.error('[Timecards Users] Error fetching users:', error);
      } finally {
        setLoadingData(false);
      }
    };

    fetchUsers();
  }, [userProfile]);

  const handleUserClick = (uid: string) => {
    router.push(`/organization/timecards?userId=${uid}`);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">タイムカード管理 - スタッフ選択</h1>
          <button
            onClick={() => router.push('/dashboard/company')}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← ダッシュボード
          </button>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b">
            <p className="text-sm text-gray-600">
              スタッフを選択してタイムカードを確認・編集します
            </p>
          </div>
          
          <div className="divide-y">
            {users.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                スタッフがいません
              </div>
            ) : (
              users.map(user => (
                <button
                  key={user.uid}
                  onClick={() => handleUserClick(user.uid)}
                  disabled={user.deleted}
                  className={`w-full p-4 text-left hover:bg-gray-50 transition-colors flex items-center justify-between ${
                    user.deleted ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  <div>
                    <div className="font-medium text-gray-900">
                      {user.deleted && <span className="text-red-600 mr-2">(退職済み)</span>}
                      {user.displayName}
                    </div>
                    <div className="text-sm text-gray-500">{user.email}</div>
                  </div>
                  {!user.deleted && (
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-600">
          <p>※ 退職済みスタッフのタイムカードは編集できません</p>
        </div>
      </div>
    </div>
  );
}
