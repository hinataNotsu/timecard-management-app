'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Organization } from '@/types';

export default function CompanyDashboard() {
  const { userProfile, loading, signOut } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [staffCount, setStaffCount] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  useEffect(() => {
    console.log('[Company Dashboard] loading:', loading, 'userProfile:', userProfile);
    
    if (!loading) {
      if (!userProfile) {
        console.log('[Company Dashboard] No user profile, redirecting to login');
        router.push('/login/company');
      } else if (!userProfile.isManage) {
        // isManageがfalseの場合もリダイレクト
        console.log('[Company Dashboard] User is not manager, redirecting to login');
        router.push('/login/company');
      } else {
        console.log('[Company Dashboard] User authorized, showing dashboard');
      }
    }
  }, [userProfile, loading, router]);

  useEffect(() => {
    const fetchOrganization = async () => {
      if (userProfile?.currentOrganizationId) {
        const orgDoc = await getDoc(doc(db, 'organizations', userProfile.currentOrganizationId));
        if (orgDoc.exists()) {
          setOrganization(orgDoc.data() as Organization);
        }
      }
    };

    const fetchStaffCount = async () => {
      if (userProfile?.currentOrganizationId) {
        try {
          // 組織に所属しているユーザーを取得（削除済みを除外）
          const usersQuery = query(
            collection(db, 'users'),
            where('organizationIds', 'array-contains', userProfile.currentOrganizationId)
          );
          const usersSnapshot = await getDocs(usersQuery);
          
          // 削除済みユーザーを除外してカウント
          const activeUsers = usersSnapshot.docs.filter(doc => {
            const data = doc.data();
            return !data.deleted;
          });
          
          setStaffCount(activeUsers.length);
        } catch (error) {
          console.error('[Company Dashboard] Error fetching staff count:', error);
          setStaffCount(0);
        }
      }
    };

    fetchOrganization();
    fetchStaffCount();
  }, [userProfile]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!userProfile) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">企業ダッシュボード</h1>
            {organization && (
              <p className="text-sm text-gray-600">{organization.name}</p>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition"
          >
            ログアウト
          </button>
        </div>
      </header>

      {/* 企業ID表示コンテナ */}
      {userProfile?.currentOrganizationId && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <span className="text-sm text-blue-700 font-semibold">企業ID：</span>
              <span className="text-sm font-mono text-blue-900 select-all break-all">{userProfile.currentOrganizationId}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`px-2 py-1 text-xs rounded transition ${copied ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                onClick={async () => {
                  await navigator.clipboard.writeText(userProfile.currentOrganizationId ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? 'コピーしました！' : 'コピー'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* スタッフ管理カード */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">スタッフ管理</h2>
            <p className="text-gray-600 mb-4">アルバイトスタッフの管理</p>
            <button onClick={() => router.push('/organization/members')} className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition">
              スタッフ一覧
            </button>
          </div>

          {/* シフト管理カード */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">シフト管理</h2>
            <p className="text-gray-600 mb-4">提出されたシフトの確認・承認</p>
            <button onClick={() => router.push('/shifts/list')} className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition">
              シフトを見る
            </button>
          </div>

          {/* 給与計算カード */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">給与計算</h2>
            <p className="text-gray-600 mb-4">スタッフの給与を計算</p>
            <button onClick={() => router.push('/payroll')} className="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition">
              給与計算
            </button>
          </div>

          {/* タイムカード管理カード */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">タイムカード管理</h2>
            <p className="text-gray-600 mb-4">出退勤の記録を確認</p>
            <button onClick={() => router.push('/timecards')} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition">
              記録を見る
            </button>
          </div>

          {/* レポートカード */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">レポート</h2>
            <p className="text-gray-600 mb-4">労働時間・給与の集計</p>
            <button onClick={() => router.push('/report')} className="w-full px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 transition">
              レポート
            </button>
          </div>

          {/* タイムカードカード (isWatchAdmin=trueの場合のみ表示) */}
          {organization?.isWatchAdmin === true && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">タイムカード</h2>
              <p className="text-gray-600 mb-4">スタッフのタイムカード管理</p>
              <button onClick={() => router.push('/organization/timecards/users')} className="w-full px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition">
                管理する
              </button>
            </div>
          )}

          {/* 設定カード */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">設定</h2>
            <p className="text-gray-600 mb-4">企業情報の編集</p>
            <button onClick={() => router.push('/organization/settings')} className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition">
              設定
            </button>
          </div>
        </div>

        {/* 統計情報 */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">登録スタッフ数</p>
            <p className="text-2xl font-bold text-gray-900">{staffCount}名</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">今月のシフト</p>
            <p className="text-2xl font-bold text-gray-900">0件</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">今月の総労働時間</p>
            <p className="text-2xl font-bold text-gray-900">0時間</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-600 mb-1">今月の給与総額</p>
            <p className="text-2xl font-bold text-gray-900">¥0</p>
          </div>
        </div>
      </main>
    </div>
  );
}
