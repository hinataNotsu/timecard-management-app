'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export default function MemberEditPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params?.userId as string;
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // ユーザー情報
  const [memberData, setMemberData] = useState<{
    displayName: string;
    email: string;
    avatarSeed?: string;
    avatarBgColor?: string;
  } | null>(null);
  
  // 編集可能なフィールド
  const [hourlyWage, setHourlyWage] = useState<number | undefined>(undefined);
  const [transportAllowance, setTransportAllowance] = useState<number | undefined>(undefined);

  const orgId = userProfile?.currentOrganizationId;

  // アバター生成関数
  const avatarUrl = (seed: string, bgColor?: string) => {
    const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
    const params = bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear';
    return `${base}${params}&fontWeight=700&radius=50`;
  };

  useEffect(() => {
    if (!userProfile?.isManage) {
      router.push('/staff/dashboard');
      return;
    }
  }, [userProfile, router]);

  useEffect(() => {
    const loadMemberData = async () => {
      if (!orgId || !userId) return;
      
      setLoading(true);
      try {
        // ユーザー基本情報を取得
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (!userDoc.exists()) {
          alert('ユーザーが見つかりません');
          router.push('/company/members');
          return;
        }
        
        const userData = userDoc.data();
        setMemberData({
          displayName: userData.displayName || userId,
          email: userData.email || '',
          avatarSeed: userData.avatarSeed || userData.displayName || userId,
          avatarBgColor: userData.avatarBackgroundColor,
        });

        // 組織メンバー設定を取得
        const memberDoc = await getDoc(doc(db, 'organizations', orgId, 'members', userId));
        if (memberDoc.exists()) {
          const data = memberDoc.data();
          setHourlyWage(typeof data.hourlyWage === 'number' ? data.hourlyWage : undefined);
          setTransportAllowance(typeof data.transportAllowancePerShift === 'number' ? data.transportAllowancePerShift : undefined);
        } else {
          // ドキュメントが存在しない場合、組織のデフォルト時給を取得
          const orgDoc = await getDoc(doc(db, 'organizations', orgId));
          if (orgDoc.exists()) {
            const orgData = orgDoc.data();
            const defaultWage = orgData.defaultHourlyWage;
            setHourlyWage(typeof defaultWage === 'number' ? defaultWage : undefined);
          }
          setTransportAllowance(0);
        }
      } catch (e) {
        console.error('[MemberEdit] load error', e);
        alert('データの読み込みに失敗しました');
      } finally {
        setLoading(false);
      }
    };

    loadMemberData();
  }, [orgId, userId, router]);

  const handleSave = async () => {
    if (!orgId || !userId) return;
    
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'organizations', orgId, 'members', userId),
        {
          hourlyWage: typeof hourlyWage === 'number' ? hourlyWage : null,
          transportAllowancePerShift: typeof transportAllowance === 'number' ? transportAllowance : null,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      
      alert('保存しました');
      router.push('/company/members');
    } catch (e) {
      console.error('[MemberEdit] save error', e);
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!memberData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* App Bar */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={() => router.push('/company/members')}
            className="text-gray-600 hover:text-gray-900"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <img 
            src={avatarUrl(memberData.avatarSeed || memberData.displayName, memberData.avatarBgColor)} 
            alt={memberData.displayName}
            className="w-10 h-10 rounded-full ring-2 ring-gray-200"
          />
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{memberData.displayName}</h1>
            <p className="text-sm text-gray-500">{memberData.email}</p>
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-bold mb-6">メンバー情報編集</h2>
          
          <div className="space-y-6">
            {/* 時給 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                時給（円/時）
              </label>
              <input
                type="number"
                min={0}
                value={hourlyWage ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setHourlyWage(v === '' ? undefined : Number(v));
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="例: 1200"
              />
              <p className="mt-1 text-sm text-gray-500">
                このメンバーの時給を設定します
              </p>
            </div>

            {/* 交通費 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                交通費（円/シフト）
              </label>
              <input
                type="number"
                min={0}
                value={transportAllowance ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setTransportAllowance(v === '' ? undefined : Number(v));
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="例: 500"
              />
              <p className="mt-1 text-sm text-gray-500">
                1シフトあたりの交通費を設定します
              </p>
            </div>
          </div>

          {/* 保存ボタン */}
          <div className="mt-8 flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex-1 px-6 py-3 rounded-lg font-medium text-white ${
                saving 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => router.push('/company/members')}
              className="px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50"
            >
              キャンセル
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
