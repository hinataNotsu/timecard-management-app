'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Organization, User } from '@/types';
import Link from 'next/link';

export default function CompanySignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }

    if (password.length < 6) {
      setError('パスワードは6文字以上で入力してください');
      return;
    }

    if (!companyName.trim()) {
      setError('企業名を入力してください');
      return;
    }

    setLoading(true);

    try {
      console.log('[Company Signup] Starting registration...');
      
      // ユーザー登録
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const userId = userCredential.user.uid;
      console.log('[Company Signup] User created:', userId);

      // 組織を作成
      const orgId = crypto.randomUUID();
      const orgRef = doc(db, 'organizations', orgId);
      const orgData: Organization = {
        id: orgId,
        name: companyName.trim(),
        createdBy: userId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      await setDoc(orgRef, orgData);
      console.log('[Company Signup] Organization created:', orgId);

      // Firestoreにユーザー情報を保存（組織IDと管理者権限を含む）
      const userData: User = {
        uid: userId,
        email: email,
        organizationIds: [orgId],
        currentOrganizationId: orgId,
        isManage: true,
        displayName: companyName.trim(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };

      await setDoc(doc(db, 'users', userId), userData);
      console.log('[Company Signup] User profile saved');

      // membersサブコレクションにデフォルト設定を作成
      try {
        await setDoc(doc(db, 'organizations', orgId, 'members', userId), {
          transportAllowancePerShift: 0,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        console.log('[Company Signup] Member document created');
      } catch (err) {
        console.warn('[Company Signup] Failed to create member document:', err);
      }

      // ページをリロードしてAuthContextに最新のユーザー情報を読み込ませる
      console.log('[Company Signup] Reloading page to refresh auth state...');
      window.location.href = '/dashboard/company';
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('このメールアドレスは既に使用されています');
      } else if (err.code === 'auth/invalid-email') {
        setError('メールアドレスの形式が正しくありません');
      } else {
        setError('アカウントの作成に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            企業登録
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            既にアカウントをお持ちですか？{' '}
            <Link href="/login/company" className="font-medium text-blue-600 hover:text-blue-500">
              ログイン
            </Link>
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
              <label htmlFor="company-name" className="block text-sm font-medium text-gray-700 mb-1">
                企業名
              </label>
              <input
                id="company-name"
                name="company-name"
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="株式会社〇〇"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                メールアドレス
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                パスワード
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="6文字以上"
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                パスワード（確認）
              </label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="パスワードを再入力"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text白 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? '登録中...' : '企業登録'}
            </button>
          </div>

          <div className="text-center">
            <Link href="/" className="text-sm text-gray-600 hover:text-gray-900">
              ← トップページに戻る
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
