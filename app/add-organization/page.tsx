'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import Link from 'next/link';

function AddOrganizationForm() {
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { userProfile, updateUserProfile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // returnTo関連のロジックは不要なので削除

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      console.log('[Add Organization] Firebase Auth currentUser:', auth.currentUser);
      console.log('[Add Organization] UserProfile:', userProfile);
      console.log('[Add Organization] UserProfile.displayName:', userProfile?.displayName);
      console.log('[Add Organization] UserProfile.email:', userProfile?.email);
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
      if (userProfile?.uid) {
        const orgData = orgDoc.data();
        const permissionList = Array.isArray(orgData.permissionList) ? orgData.permissionList : [];
        const alreadyRequested = permissionList.some((p: any) => p.uid === userProfile.uid);
        if (alreadyRequested) {
          setError('既に申請中です');
          setLoading(false);
          return;
        }
        // permissionListに申請データを追加
        const { arrayUnion, updateDoc } = await import('firebase/firestore');
        const applicationData = {
          uid: userProfile.uid,
          displayName: userProfile.displayName || '',
          email: userProfile.email || '',
          createdAt: Timestamp.now(),
        };
        console.log('[Add Organization] Application data to save:', applicationData);
        await updateDoc(orgDocRef, {
          permissionList: arrayUnion(applicationData)
        });
      }
      setDialogOpen(true);
    } catch (err: any) {
      console.error('[Add Organization] Error details:', err);
      const errorDetails = `
エラーコード: ${err.code || 'unknown'}
メッセージ: ${err.message}
詳細: ${JSON.stringify(err, null, 2)}`;
      setError(`申請に失敗しました: ${err.message}${errorDetails}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/part-time');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            組織を申請
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            追加したい組織の企業IDを入力してください
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

          <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="flex-1 py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? '申請中...' : '申請する'}
              </button>
          </div>
        </form>
      </div>
      {/* 申請完了ダイアログ */}
      {dialogOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-50">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <h3 className="text-lg font-bold mb-4">申請しました</h3>
            <p className="mb-6">管理者が承認するまでお待ちください。</p>
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              onClick={() => {
                setDialogOpen(false);
                router.push('/dashboard/part-time');
              }}
            >閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AddOrganizationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    }>
      <AddOrganizationForm />
    </Suspense>
  );
}
