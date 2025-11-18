'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function PartTimeSignUpPage() {
  const router = useRouter();

  useEffect(() => {
    // 新規会員登録は廃止。ログインへリダイレクト
    router.replace('/login/part-time');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-6 text-center">
        <h2 className="mt-6 text-2xl font-bold text-gray-900">新規会員登録は管理者が行います</h2>
        <p className="text-gray-700">ログインページへ移動します。</p>
        <Link href="/login/part-time" className="text-blue-600 hover:text-blue-700">アルバイトログインへ</Link>
      </div>
    </div>
  );
}
