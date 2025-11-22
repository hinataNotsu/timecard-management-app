'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function CompanyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userProfile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!userProfile) {
        router.push('/');
      } else if (!userProfile.isManage) {
        router.push('/');
      } else if (userProfile.currentOrganizationId && 
                 (!userProfile.organizationIds || 
                  !userProfile.organizationIds.includes(userProfile.currentOrganizationId))) {
        // 現在選択中の組織が自分の所属リストにない場合
        router.push('/');
      }
    }
  }, [userProfile, loading, router]);

  if (loading || !userProfile || !userProfile.isManage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  // 所属チェック
  if (userProfile.currentOrganizationId && 
      (!userProfile.organizationIds || 
       !userProfile.organizationIds.includes(userProfile.currentOrganizationId))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">この組織にアクセスする権限がありません</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
