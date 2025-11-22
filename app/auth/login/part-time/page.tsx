'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

export default function PartTimeLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      console.log('[Login] Attempting login for:', email);
      const userCredential = await signIn(email, password);
      const user = userCredential.user;
      console.log('[Login] Login successful, user:', user.uid);
      
      // Firestoreからユーザー情報を取得してrequirePasswordChangeをチェック
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('@/lib/firebase');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      
      if (!userDoc.exists()) {
        console.error('[Login] User document not found in Firestore');
        setError('ユーザー情報が見つかりません。管理者に連絡してください。');
        return;
      }
      
      const userData = userDoc.data();
      console.log('[Login] User data:', userData);
      
      if (userData?.requirePasswordChange) {
        console.log('[Login] Password change required, redirecting to profile');
        // パスワード変更が必要な場合はプロフィール画面へ
        router.push('/staff/profile?passwordChangeRequired=true');
      } else if (!userData?.profileCompleted) {
        console.log('[Login] Profile onboarding required, redirecting to profile');
        router.push('/staff/profile');
      } else {
        console.log('[Login] Redirecting to dashboard');
        window.location.href = '/staff/dashboard';
      }
    } catch (err: any) {
      console.error('[Login] Error:', err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('メールアドレスまたはパスワードが正しくありません');
      } else if (err.code === 'auth/invalid-email') {
        setError('メールアドレスの形式が正しくありません');
      } else if (err.code === 'auth/invalid-credential') {
        setError('認証情報が無効です。メールアドレスとパスワードを確認してください');
      } else {
        setError(`ログインに失敗しました: ${err.message || err.code || '不明なエラー'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">アルバイトログイン</h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            アカウントをお持ちでない方は{' '}
            <Link href="/signup/part-time" className="font-medium text-blue-600 hover:text-blue-500">新規登録</Link>
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          <div className="rounded-md shadow-sm space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
              <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm" placeholder="email@example.com" />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm" placeholder="パスワード" />
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed">{loading ? 'ログイン中...' : 'ログイン'}</button>
          <div className="text-center mt-4">
            <Link href="/" className="text-sm text-gray-600 hover:text-gray-900">← トップページに戻る</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
