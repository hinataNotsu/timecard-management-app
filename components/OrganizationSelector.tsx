'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Organization } from '@/types';

interface OrganizationSelectorProps {
  onOrganizationChange?: (orgId: string) => void;
}

export default function OrganizationSelector({ onOrganizationChange }: OrganizationSelectorProps) {
  const { userProfile, updateUserProfile } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const fetchOrganizations = async () => {
      if (!userProfile?.organizationIds || userProfile.organizationIds.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const orgPromises = userProfile.organizationIds.map(async (orgId) => {
          const orgDoc = await getDoc(doc(db, 'organizations', orgId));
          if (orgDoc.exists()) {
            return orgDoc.data() as Organization;
          }
          return null;
        });

        const orgs = await Promise.all(orgPromises);
        setOrganizations(orgs.filter((org) => org !== null) as Organization[]);
      } catch (error) {
        console.error('Failed to fetch organizations:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchOrganizations();
  }, [userProfile?.organizationIds]);

  const handleOrganizationChange = async (orgId: string) => {
    try {
      await updateUserProfile({
        currentOrganizationId: orgId,
      });
      setIsOpen(false);
      if (onOrganizationChange) {
        onOrganizationChange(orgId);
      }
      // ページをリロードしてデータを更新
      window.location.reload();
    } catch (error) {
      console.error('Failed to change organization:', error);
    }
  };

  const handleAddOrganization = () => {
    setIsOpen(false);
    // 現在のダッシュボードタイプを判定
    const currentPath = window.location.pathname;
    const returnTo = currentPath.includes('/company') ? 'company' : 'staff';
    router.push(`/onboarding/add-organization?returnTo=${returnTo}`);
  };

  if (loading || !userProfile) {
    return <div className="text-sm text-gray-600">読み込み中...</div>;
  }

  // isManage=trueのユーザーがstaffダッシュボードにいる場合は組織追加を許可しない
  const currentPath = window.location.pathname;
  const isStaffDashboard = currentPath.includes('/staff');
  const canAddOrganization = !(userProfile.isManage && isStaffDashboard);

  if (organizations.length === 0) {
    if (!canAddOrganization) {
      return <div className="text-sm text-gray-600">組織に所属していません</div>;
    }
    return (
      <button
        onClick={handleAddOrganization}
        className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-300 rounded-md hover:bg-blue-100 transition text-blue-700 font-medium"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span>組織を追加</span>
      </button>
    );
  }

  const currentOrg = organizations.find(
    (org) => org.id === userProfile.currentOrganizationId
  ) || organizations[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition"
      >
        <span className="text-lg font-semibold text-gray-900">{currentOrg.name}</span>
        <svg
          className={`w-5 h-5 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 mt-2 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-20">
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => handleOrganizationChange(org.id)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition ${
                  org.id === userProfile.currentOrganizationId
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-gray-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{org.name}</span>
                  {org.id === userProfile.currentOrganizationId && (
                    <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
              </button>
            ))}
            {canAddOrganization && (
              <>
                {/* 区切り線 */}
                <div className="border-t border-gray-200" />
                {/* 組織を追加ボタン */}
                <button
                  onClick={handleAddOrganization}
                  className="w-full text-left px-4 py-3 hover:bg-blue-50 transition text-blue-600 font-medium flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>組織を追加</span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
