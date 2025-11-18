'use client';

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function OrganizationStaffPage() {
  const { userProfile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!userProfile) return;
    if (!userProfile.isManage) {
      router.push('/dashboard/part-time');
    }
  }, [userProfile, router]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/organization/members" className="text-2xl font-bold text-gray-500 hover:text-gray-800">メンバー管理</Link>
            <Link href="/organization/staff" className="text-2xl font-bold text-blue-700">スタッフ管理</Link>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push('/dashboard/company')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">スタッフ管理（準備中）</h2>
          <p className="text-gray-600 text-sm">ここにスタッフに固有の権限設定や役職、タグ付け、検索フィルタなどを配置予定です。</p>
          <ul className="mt-4 list-disc list-inside text-sm text-gray-500 space-y-1">
            <li>役職（店長 / 副店長 / リーダー など）設定</li>
            <li>権限範囲（シフト承認 / 給与閲覧 / メンバー編集）</li>
            <li>タグ分類（新人 / 時短 / 夜勤対応 など）</li>
            <li>並び替え・検索（名前 / 権限 / 作成日）</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
