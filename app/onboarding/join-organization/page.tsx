'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, setDoc, collection, addDoc, Timestamp, getDocs, QueryDocumentSnapshot, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

export default function JoinOrganizationPage() {
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const { userProfile, updateUserProfile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // 既に組織に所属している場合はダッシュボードにリダイレクト
    if (userProfile) {
      if (userProfile.organizationIds && userProfile.organizationIds.length > 0) {
        const dashboardPath = userProfile.isManage ? '/company/dashboard' : '/staff/dashboard';
        router.push(dashboardPath);
      } else {
        setVerifying(false);
      }
    }
  }, [userProfile, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      console.log('[Join Organization] Firebase Auth currentUser:', auth.currentUser);
      console.log('[Join Organization] UserProfile:', userProfile);
      console.log('[Join Organization] UserProfile.displayName:', userProfile?.displayName);
      console.log('[Join Organization] UserProfile.email:', userProfile?.email);
      const inputId = organizationId.trim();
      if (!inputId) {
        setError('企業IDを入力してください');
        setLoading(false);
        return;
      }
      // 組織が存在するか確認
      const orgDocRef = doc(db, 'organizations', inputId);
      const orgDoc = await getDoc(orgDocRef);
      if (!orgDoc.exists()) {
        setError('入力された企業IDが見つかりません。正しいIDを入力してください。');
        setLoading(false);
        return;
      }
      // permissionListに既に申請があるかチェック
      if (!userProfile?.uid) {
        setError('ユーザー情報が取得できませんでした。権限がありません。再度ログインしてください。');
        setLoading(false);
        return;
      }
      const orgData = orgDoc.data();
      const permissionList = Array.isArray(orgData.permissionList) ? orgData.permissionList : [];
      const alreadyRequested = permissionList.some((p: any) => p.uid === userProfile.uid);
      if (alreadyRequested) {
        setError('既に申請中です');
        setLoading(false);
        return;
      }
      // permissionListに申請データを追加
      const applicationData = {
        uid: userProfile.uid,
        displayName: userProfile.displayName || '',
        email: userProfile.email || '',
        createdAt: Timestamp.now(),
      };
      console.log('[Join Organization] Application data to save:', applicationData);
      await updateDoc(orgDocRef, {
        permissionList: arrayUnion(applicationData)
      });
      setShowDialog(true);
    } catch (err: any) {
      console.error('[Join Organization] Error details:', err);
      const errorDetails = `
エラーコード: ${err.code || 'unknown'}
メッセージ: ${err.message}
詳細: ${JSON.stringify(err, null, 2)}`;
      setError(`申請に失敗しました: ${err.message}${errorDetails}`);
    } finally {
      setLoading(false);
    }
  };

  if (verifying) {
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            企業IDを入力
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            勤務先の企業から提供された企業IDを入力してください
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          <div>
            <label htmlFor="organization-id" className="block text-sm font-medium text-gray-700 mb-1">
              企業ID
            </label>
            <input
              id="organization-id"
              name="organization-id"
              type="text"
              required
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
              placeholder="企業IDを入力してください"
            />
            <p className="mt-2 text-xs text-gray-500">
              ※ 企業IDは企業の管理者から提供されます
            </p>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
                {loading ? '申請中...' : '申請する'}
            </button>
          </div>
        </form>
      </div>
      {showDialog && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
          <div className="bg-white rounded-lg shadow-lg p-8 max-w-sm w-full text-center">
            <h3 className="text-xl font-bold mb-4">申請しました</h3>
            <p className="mb-6">管理者が承認するまでお待ちください。</p>
            <button
              className="px-6 py-2 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700"
              onClick={() => {
                setShowDialog(false);
                router.push('/');
              }}
            >OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
