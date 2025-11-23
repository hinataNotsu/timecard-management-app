'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const router = useRouter();
  const { userProfile, loading } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [avatarSeed, setAvatarSeed] = useState('');
  const [avatarBackgroundColor, setAvatarBackgroundColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<'none' | 'password' | 'profile'>('none');
  
  // パスワード変更用
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!userProfile) {
      router.push('/login/part-time');
      return;
    }
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', userProfile.uid));
        if (snap.exists()) {
          const u = snap.data() as any;
          setDisplayName(u.displayName || '');
          setEmail(u.email || userProfile.email || '');
          setPhoneNumber(u.phoneNumber || '');
          setAvatarSeed(u.avatarSeed || (u.displayName || userProfile.uid));
          setAvatarBackgroundColor(u.avatarBackgroundColor || '');
          setIsOnboarding(!u.profileCompleted);
          
          // URLパラメータまたはrequirePasswordChangeフラグをチェック
          const params = new URLSearchParams(window.location.search);
          const needPassword = params.get('passwordChangeRequired') === 'true' || u.requirePasswordChange;
          const needProfile = !u.profileCompleted;
          if (needPassword) {
            setShowPasswordChange(true);
            setOnboardingStep('password');
          } else if (needProfile) {
            setOnboardingStep('profile');
          } else {
            setOnboardingStep('none');
          }
        } else {
          setDisplayName(userProfile.displayName || '');
          setEmail(userProfile.email || '');
          setAvatarSeed(userProfile.displayName || userProfile.uid);
          setIsOnboarding(true);
          setOnboardingStep('profile');
        }
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, [loading, userProfile, router]);

  const save = async () => {
    if (!userProfile) return;
    if (!displayName.trim()) {
      toast.error('表示名を入力してください');
      return;
    }
    if (displayName.trim().length > 20) {
      toast.error('表示名は20文字以内で入力してください');
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', userProfile.uid), {
        displayName: displayName.trim(),
        phoneNumber: phoneNumber.trim(),
        avatarSeed: avatarSeed.trim() || displayName.trim() || userProfile.uid,
        avatarBackgroundColor: avatarBackgroundColor.trim(),
        ...(isOnboarding ? { profileCompleted: true } : {}),
        updatedAt: Timestamp.now(),
      } as any);
      toast.success(isOnboarding ? 'プロフィール登録が完了しました' : '保存しました');
      if (isOnboarding) {
        router.push('/staff/dashboard');
      } else {
        router.back();
      }
    } catch (e) {
      console.error('[Profile] save error', e);
      toast.error('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!auth.currentUser || !userProfile) return;
    
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      toast.error('全ての項目を入力してください');
      return;
    }
    
    if (newPassword !== confirmNewPassword) {
      toast.error('新しいパスワードが一致しません');
      return;
    }
    
    if (newPassword.length < 6) {
      toast.error('パスワードは6文字以上で入力してください');
      return;
    }
    
    setChangingPassword(true);
    try {
      // 再認証
      const credential = EmailAuthProvider.credential(userProfile.email || '', currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      
      // パスワード更新
      await updatePassword(auth.currentUser, newPassword);
      
      // requirePasswordChangeフラグを削除
      await updateDoc(doc(db, 'users', userProfile.uid), {
        requirePasswordChange: false,
        updatedAt: Timestamp.now(),
      });
      
      toast.success('パスワードを変更しました');
      if (isOnboarding) {
        // 次はプロフィール登録へ
        setOnboardingStep('profile');
        setShowPasswordChange(false);
      } else {
        setShowPasswordChange(false);
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      
      // URLパラメータをクリア
      const url = new URL(window.location.href);
      url.searchParams.delete('passwordChangeRequired');
      window.history.replaceState({}, '', url.toString());
      
      // パラメータだけクリア（画面は次のステップに遷移）
    } catch (e: any) {
      console.error('[Profile] password change error', e);
      if (e.code === 'auth/wrong-password') {
        toast.error('現在のパスワードが正しくありません');
      } else if (e.code === 'auth/too-many-requests') {
        toast.error('試行回数が多すぎます。しばらく待ってから再度お試しください');
      } else {
        toast.error('パスワードの変更に失敗しました');
      }
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading || !loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!userProfile) return null;

  const avatarUrl = (seed: string, bgColor?: string) => {
    const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
    const params = bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear';
    return `${base}${params}&fontWeight=700&radius=50`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => router.back()} className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm sm:text-base">戻る</button>
              <h1 className="text-base sm:text-2xl font-bold text-gray-900">{onboardingStep === 'password' ? '初回設定: パスワード変更' : (isOnboarding ? 'プロフィール登録' : 'プロフィール編集')}</h1>
            </div>
            {onboardingStep !== 'password' && (
              <button
                onClick={save}
                disabled={saving}
                className={`px-4 py-2 rounded text-sm sm:text-base font-semibold whitespace-nowrap ${saving ? 'bg-gray-300 text-gray-600' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
              >
                {saving ? '保存中...' : (isOnboarding ? '登録' : '保存')}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8">
        {onboardingStep !== 'password' && (
        <div className="bg-white rounded-lg shadow p-4 sm:p-6 space-y-4 sm:space-y-6">
          {isOnboarding && (
            <div className="mb-2 bg-blue-50 border border-blue-200 rounded p-3">
              <p className="text-sm text-blue-800">初回ログインのため、プロフィールを登録してください（表示名は必須）。</p>
            </div>
          )}
          
          {/* アバタープレビュー */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <img src={avatarUrl(avatarSeed || displayName || userProfile.uid, avatarBackgroundColor)} alt="avatar" className="w-16 h-16 rounded-full ring-1 ring-gray-200" />
            <div className="flex-1">
              <p className="text-sm text-gray-600">プレビュー（DiceBear）</p>
              <p className="text-xs text-gray-500">表示名/シードを変更すると自動で更新されます</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">表示名<span className="text-red-500">*</span></label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
              maxLength={30}
              placeholder="例: 山田 太郎"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メール（変更不可）</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full px-3 py-2 border rounded bg-gray-50 text-gray-600 text-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">電話番号（任意）</label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
              placeholder="例: 090-1234-5678"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">アバターシード（任意）</label>
            <input
              type="text"
              value={avatarSeed}
              onChange={(e) => setAvatarSeed(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-base"
              placeholder="表示名ベースで自動生成されます"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">アバター背景色（任意）</label>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={avatarBackgroundColor}
                onChange={(e) => setAvatarBackgroundColor(e.target.value)}
                className="flex-1 px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: FF5733, blue, rgb(100,150,200)"
              />
              <input
                type="color"
                value={avatarBackgroundColor.startsWith('#') ? avatarBackgroundColor : `#${avatarBackgroundColor}`}
                onChange={(e) => setAvatarBackgroundColor(e.target.value.substring(1))}
                className="w-12 h-10 border rounded cursor-pointer"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">空欄の場合はグラデーション背景になります</p>
          </div>
        </div>
        )}

        {/* パスワード変更セクション */}
        {onboardingStep !== 'profile' && (
        <div className="mt-4 bg-white rounded-lg shadow p-4 sm:p-6 space-y-4">
          {(userProfile?.requirePasswordChange || onboardingStep === 'password') && (
            <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded p-3">
              <p className="text-sm text-yellow-800">
                ⚠️ 初回ログインのため、セキュリティ向上のためパスワード変更を推奨します。
              </p>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">パスワード変更</h2>
            {onboardingStep !== 'password' && (
              <button
                onClick={() => setShowPasswordChange(!showPasswordChange)}
                className="px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-700 w-fit"
              >
                {showPasswordChange ? '閉じる' : '変更する'}
              </button>
            )}
          </div>
          
          {(showPasswordChange || onboardingStep === 'password') && (
            <div className="space-y-4 pt-4 border-t">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">現在のパスワード</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="現在のパスワード"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">新しいパスワード</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="6文字以上"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">新しいパスワード（確認）</label>
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="もう一度入力"
                />
              </div>
              
              <div className="flex justify-end gap-2">
                {(userProfile?.requirePasswordChange || onboardingStep === 'password') && (
                  <button
                    onClick={async () => {
                      // スキップ：requirePasswordChangeフラグを削除
                      await updateDoc(doc(db, 'users', userProfile.uid), {
                        requirePasswordChange: false,
                        updatedAt: Timestamp.now(),
                      });
                      if (isOnboarding) {
                        setOnboardingStep('profile');
                        setShowPasswordChange(false);
                      } else {
                        setShowPasswordChange(false);
                      }
                      const url = new URL(window.location.href);
                      url.searchParams.delete('passwordChangeRequired');
                      window.history.replaceState({}, '', url.toString());
                      toast('パスワード変更をスキップしました。');
                    }}
                    className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                  >
                    スキップ
                  </button>
                )}
                <button
                  onClick={handlePasswordChange}
                  disabled={changingPassword}
                  className={`px-4 py-2 rounded ${changingPassword ? 'bg-gray-300 text-gray-600' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                >
                  {changingPassword ? '変更中...' : 'パスワードを変更'}
                </button>
              </div>
            </div>
          )}
        </div>
        )}
      </main>
    </div>
  );
}
