'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { User } from '@/types';

interface UserRow {
  uid: string;
  displayName: string;
  email: string;
  deleted: boolean;
  avatarSeed?: string;
  avatarBackgroundColor?: string;
}

export default function TimecardsUsersPage() {
  const { userProfile, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [displayCount, setDisplayCount] = useState(20);
  const [isWatchAdmin, setIsWatchAdmin] = useState<boolean | null>(null);

  const orgId = userProfile?.currentOrganizationId;

  // 組織設定のisWatchAdminをチェック
  useEffect(() => {
    if (!orgId) return;
    const checkOrgSettings = async () => {
      try {
        const orgDoc = await getDoc(doc(db, 'organizations', orgId));
        if (orgDoc.exists()) {
          const orgData = orgDoc.data();
          const watchAdmin = orgData.isWatchAdmin !== false; // デフォルトtrue
          setIsWatchAdmin(watchAdmin);
        }
      } catch (error) {
        console.error('[Timecards Users] Error checking org settings:', error);
      }
    };
    checkOrgSettings();
  }, [orgId]);

  // アクセス制御
  useEffect(() => {
    if (loading) return; // 認証ロード中は何もしない
    
    if (!userProfile || !userProfile.isManage) {
      router.push('/staff/dashboard');
      return;
    }
    // isWatchAdminがfalseの場合、このページにアクセスできない
    if (isWatchAdmin === false) {
      router.push('/company/dashboard');
    }
  }, [userProfile, loading, isWatchAdmin, router]);

  // ユーザー一覧を取得
  useEffect(() => {
    // 認証ロード中、または組織IDがない場合はスキップ
    if (loading || !orgId) return;
    
    const fetchUsers = async () => {
      setLoadingData(true);
      try {
        // organizationIdsに現在の組織IDを含むユーザーを取得
        const q = query(
          collection(db, 'users'),
          where('organizationIds', 'array-contains', orgId)
        );
        const snapshot = await getDocs(q);

        const userList: UserRow[] = snapshot.docs.map(doc => {
          const data = doc.data() as User;
          return {
            uid: data.uid,
            displayName: data.displayName || data.email || data.uid,
            email: data.email,
            deleted: data.deleted || false,
            avatarSeed: data.avatarSeed || data.displayName || data.uid,
            avatarBackgroundColor: data.avatarBackgroundColor,
          };
        });

        // 退職済みユーザーを除外し、名前の昇順でソート
        const activeUsers = userList.filter(user => !user.deleted);
        activeUsers.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));

        setUsers(activeUsers);
      } catch (error) {
        console.error('[Timecards Users] Error fetching users:', error);
      } finally {
        setLoadingData(false);
      }
    };

    fetchUsers();
  }, [loading, orgId]); // loading と orgId に依存

  // 検索フィルタリング
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase().trim();
    return users.filter(user => 
      user.displayName.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  // 無限スクロール用の表示ユーザー
  const displayedUsers = useMemo(() => {
    return filteredUsers.slice(0, displayCount);
  }, [filteredUsers, displayCount]);

  // スクロールイベント
  useEffect(() => {
    const handleScroll = () => {
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
        setDisplayCount(prev => Math.min(prev + 20, filteredUsers.length));
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [filteredUsers.length]);

  // DiceBear APIでアバター画像URLを生成
  const avatarUrl = (seed: string, bgColor?: string) => {
    const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
    const params = bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear';
    return `${base}${params}&fontWeight=700&radius=50`;
  };

  const handleUserClick = (uid: string) => {
    router.push(`/company/timecards/${uid}`);
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
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* ヘッダー */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold">タイムカード管理</h1>
            <button
              onClick={() => router.push('/company/dashboard')}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
            >
              ← ダッシュボード
            </button>
          </div>

          {/* 検索バー */}
          <div className="relative">
            <input
              type="text"
              placeholder="スタッフ名で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 pl-11 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* 検索結果件数 */}
          <div className="mt-3 text-sm text-gray-600">
            {searchQuery ? (
              <span>
                <strong>{filteredUsers.length}</strong> 件の検索結果
              </span>
            ) : (
              <span>
                全 <strong>{users.length}</strong> 名のスタッフ
              </span>
            )}
          </div>
        </div>

        {/* スタッフカードグリッド */}
        {filteredUsers.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <svg
              className="mx-auto w-16 h-16 text-gray-300 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <p className="text-gray-500 text-lg">
              {searchQuery ? '該当するスタッフが見つかりません' : 'スタッフがいません'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {displayedUsers.map(user => (
                <button
                  key={user.uid}
                  onClick={() => handleUserClick(user.uid)}
                  className="bg-white rounded-lg shadow hover:shadow-md hover:bg-gray-50 transition-all p-4 flex flex-col items-center gap-3"
                >
                  {/* アバター */}
                  <img 
                    src={avatarUrl(user.avatarSeed || user.displayName || user.uid, user.avatarBackgroundColor)} 
                    alt={user.displayName}
                    className="w-14 h-14 rounded-full ring-2 ring-gray-200"
                  />
                  
                  {/* 名前 */}
                  <div className="text-center w-full">
                    <p className="font-medium text-gray-900 text-sm truncate" title={user.displayName}>
                      {user.displayName}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* 無限スクロールのローディング */}
            {displayedUsers.length < filteredUsers.length && (
              <div className="mt-8 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-sm text-gray-600">読み込み中...</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}