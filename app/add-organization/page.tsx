'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

function AddOrganizationForm() {
  const [organizationId, setOrganizationId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [returnTo, setReturnTo] = useState<'company' | 'part-time'>('part-time');
  const { userProfile, updateUserProfile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const returnToParam = searchParams.get('returnTo');
    if (returnToParam === 'company' || returnToParam === 'part-time') {
      setReturnTo(returnToParam);
    }

    // isManage=trueのユーザーがpart-timeから来た場合はブロック
    if (userProfile?.isManage && returnToParam === 'part-time') {
      setError('管理者はアルバイトダッシュボードから組織を追加できません');
      setTimeout(() => {
        router.push('/dashboard/part-time');
      }, 2000);
    }
  }, [searchParams, userProfile, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const inputId = organizationId.trim();
      console.log('[Add Organization] Input ID:', inputId);
      
      // 組織が存在するか確認
      const orgDocRef = doc(db, 'organizations', inputId);
      const orgDoc = await getDoc(orgDocRef);
      
      if (!orgDoc.exists()) {
        console.log('[Add Organization] Organization not found');
        setError('入力された企業IDが見つかりません。正しいIDを入力してください。');
        setLoading(false);
        return;
      }

      const orgData = orgDoc.data();
      console.log('[Add Organization] Organization data:', orgData);

      // 既に所属している場合はスキップ
      const currentOrgIds = userProfile?.organizationIds || [];
      if (currentOrgIds.includes(inputId)) {
        setError('既にこの組織に所属しています');
        setLoading(false);
        return;
      }

      // ユーザープロフィールに組織IDを追加
      console.log('[Add Organization] Updating user profile...');
      await updateUserProfile({
        organizationIds: [...currentOrgIds, inputId],
        currentOrganizationId: inputId,
      });

      console.log('[Add Organization] Profile updated successfully, redirecting...');
      console.log('[Add Organization] Return to:', returnTo);
      
      // returnToパラメータに基づいてリダイレクト
      if (returnTo === 'company') {
        console.log('[Add Organization] Redirecting to company dashboard');
        window.location.href = '/dashboard/company';
      } else {
        console.log('[Add Organization] Redirecting to part-time dashboard');
        window.location.href = '/dashboard/part-time';
      }
    } catch (err: any) {
      console.error('[Add Organization] Error:', err);
      setError(`組織の追加に失敗しました: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (returnTo === 'company') {
      router.push('/dashboard/company');
    } else {
      router.push('/dashboard/part-time');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            組織を追加
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
              {loading ? '追加中...' : '追加する'}
            </button>
          </div>
        </form>
      </div>
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
