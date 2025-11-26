'use client';

import { useEffect, useState, useMemo } from 'react';
import { useToast } from '@/components/Toast';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';

type TabType = 'profile' | 'security';

// トグルスイッチコンポーネント
const Toggle = ({ 
  enabled, 
  onChange, 
  disabled = false 
}: { 
  enabled: boolean; 
  onChange: (value: boolean) => void; 
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={() => !disabled && onChange(!enabled)}
    disabled={disabled}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
      enabled ? 'bg-blue-600' : 'bg-gray-200'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
  >
    <span
      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
        enabled ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

// 設定カードコンポーネント
const SettingCard = ({
  icon,
  title,
  description,
  children,
  collapsible = false,
  defaultExpanded = true,
}: {
  icon: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  
  return (
    <div className="bg-white rounded-xl shadow-sm border">
      <div 
        className={`p-4 sm:p-5 ${collapsible ? 'cursor-pointer' : ''}`}
        onClick={() => collapsible && setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{icon}</span>
            <div>
              <h3 className="font-semibold text-gray-900">{title}</h3>
              {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
            </div>
          </div>
          {collapsible && (
            <span className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
              ▼
            </span>
          )}
        </div>
      </div>
      
      {(!collapsible || expanded) && children && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-0">
          <div className="pt-4 border-t border-gray-100">
            {children}
          </div>
        </div>
      )}
    </div>
  );
};

// 入力フィールドコンポーネント（スマホ対応）
const InputField = ({
  label,
  required = false,
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled = false,
  maxLength,
  helpText,
}: {
  label: string;
  required?: boolean;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  helpText?: string;
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1.5">
      {label}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      maxLength={maxLength}
      placeholder={placeholder}
      className={`w-full px-4 py-3 min-h-[48px] text-base border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
        disabled ? 'bg-gray-50 text-gray-500' : 'bg-white'
      }`}
    />
    {helpText && <p className="mt-1.5 text-xs text-gray-500">{helpText}</p>}
  </div>
);

export default function ProfilePage() {
  const router = useRouter();
  const { userProfile, loading } = useAuth();
  const { showSuccessToast, showErrorToast, showInfoToast } = useToast();

  // 基本情報
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  
  // アバター設定
  const [avatarSeed, setAvatarSeed] = useState('');
  const [avatarBackgroundColor, setAvatarBackgroundColor] = useState('');
  const [showAvatarSettings, setShowAvatarSettings] = useState(false);
  
  // 状態管理
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<'none' | 'password' | 'profile'>('none');
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [hasChanges, setHasChanges] = useState(false);
  const [initialState, setInitialState] = useState<string>('');
  
  // パスワード変更用
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // アバターURL生成
  const avatarUrl = useMemo(() => {
    const seed = avatarSeed || displayName || userProfile?.uid || '';
    const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
    const params = avatarBackgroundColor 
      ? `&backgroundColor=${encodeURIComponent(avatarBackgroundColor)}` 
      : '&backgroundType=gradientLinear';
    return `${base}${params}&fontWeight=700&radius=50`;
  }, [avatarSeed, displayName, avatarBackgroundColor, userProfile?.uid]);

  // データ読み込み
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
          
          // アバター設定
          const params = new URLSearchParams(window.location.search);
          const isOnboardingParam = params.get('onboarding') === '1';
          if (isOnboardingParam && (u.email || userProfile.email)) {
            const mail = u.email || userProfile.email;
            setAvatarSeed(mail.split('@')[0]);
          } else {
            setAvatarSeed(u.avatarSeed || '');
          }
          setAvatarBackgroundColor(u.avatarBackgroundColor || '');
          
          // オンボーディング状態
          setIsOnboarding(!u.profileCompleted);
          const needPassword = params.get('passwordChangeRequired') === 'true' || u.requirePasswordChange;
          const needProfile = !u.profileCompleted;
          
          if (needPassword) {
            setOnboardingStep('password');
            setActiveTab('security');
          } else if (needProfile) {
            setOnboardingStep('profile');
          } else {
            setOnboardingStep('none');
          }
          
          // 初期状態を保存
          setInitialState(JSON.stringify({
            displayName: u.displayName || '',
            phoneNumber: u.phoneNumber || '',
            avatarSeed: u.avatarSeed || '',
            avatarBackgroundColor: u.avatarBackgroundColor || '',
          }));
        } else {
          setDisplayName(userProfile.displayName || '');
          setEmail(userProfile.email || '');
          const params = new URLSearchParams(window.location.search);
          if (params.get('onboarding') === '1' && userProfile.email) {
            setAvatarSeed(userProfile.email.split('@')[0]);
          }
          setIsOnboarding(true);
          setOnboardingStep('profile');
        }
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, [loading, userProfile, router]);

  // 変更検知
  useEffect(() => {
    if (!initialState) return;
    const currentState = JSON.stringify({
      displayName,
      phoneNumber,
      avatarSeed,
      avatarBackgroundColor,
    });
    setHasChanges(currentState !== initialState);
  }, [displayName, phoneNumber, avatarSeed, avatarBackgroundColor, initialState]);

  // プロフィール保存
  const save = async () => {
    if (!userProfile) return;
    if (!displayName.trim()) {
      showInfoToast('表示名を入力してください');
      return;
    }
    if (displayName.trim().length > 20) {
      showInfoToast('表示名は20文字以内で入力してください');
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
      
      showSuccessToast(isOnboarding ? 'プロフィール登録が完了しました' : '保存しました');
      
      // 初期状態を更新
      setInitialState(JSON.stringify({
        displayName: displayName.trim(),
        phoneNumber: phoneNumber.trim(),
        avatarSeed: avatarSeed.trim(),
        avatarBackgroundColor: avatarBackgroundColor.trim(),
      }));
      setHasChanges(false);
      
      if (isOnboarding) {
        router.push('/staff/dashboard');
      }
    } catch (e) {
      console.error('[Profile] save error', e);
      showErrorToast('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // パスワード変更
  const handlePasswordChange = async () => {
    if (!auth.currentUser || !userProfile) return;
    
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      showInfoToast('全ての項目を入力してください');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      showInfoToast('新しいパスワードが一致しません');
      return;
    }
    if (newPassword.length < 6) {
      showInfoToast('パスワードは6文字以上で入力してください');
      return;
    }
    
    setChangingPassword(true);
    try {
      const credential = EmailAuthProvider.credential(userProfile.email || '', currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);
      
      await updateDoc(doc(db, 'users', userProfile.uid), {
        requirePasswordChange: false,
        updatedAt: Timestamp.now(),
      });
      
      showSuccessToast('パスワードを変更しました');
      
      if (isOnboarding) {
        setOnboardingStep('profile');
        setActiveTab('profile');
      }
      
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      
      // URLパラメータをクリア
      const url = new URL(window.location.href);
      url.searchParams.delete('passwordChangeRequired');
      window.history.replaceState({}, '', url.toString());
    } catch (e: any) {
      console.error('[Profile] password change error', e);
      if (e.code === 'auth/wrong-password') {
        showErrorToast('現在のパスワードが正しくありません');
      } else if (e.code === 'auth/too-many-requests') {
        showErrorToast('試行回数が多すぎます。しばらく待ってから再度お試しください');
      } else {
        showErrorToast('パスワードの変更に失敗しました');
      }
    } finally {
      setChangingPassword(false);
    }
  };

  // パスワード変更スキップ
  const skipPasswordChange = async () => {
    if (!userProfile) return;
    
    await updateDoc(doc(db, 'users', userProfile.uid), {
      requirePasswordChange: false,
      updatedAt: Timestamp.now(),
    });
    
    if (isOnboarding) {
      setOnboardingStep('profile');
      setActiveTab('profile');
    }
    
    const url = new URL(window.location.href);
    url.searchParams.delete('passwordChangeRequired');
    window.history.replaceState({}, '', url.toString());
    
    showInfoToast('パスワード変更をスキップしました');
  };

  // ローディング表示
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

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'profile', label: 'プロフィール', icon: '👤' },
    { id: 'security', label: 'セキュリティ', icon: '🔒' },
  ];

  // オンボーディング時のステップ表示
  const totalSteps = onboardingStep === 'password' || (isOnboarding && userProfile?.requirePasswordChange) ? 2 : 1;
  const currentStep = onboardingStep === 'password' ? 1 : (isOnboarding ? (totalSteps === 2 ? 2 : 1) : 0);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => router.back()} 
                className="p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-gray-900">
                  {onboardingStep === 'password' ? '初回設定' : (isOnboarding ? 'プロフィール登録' : 'プロフィール')}
                </h1>
                {isOnboarding && totalSteps > 1 && (
                  <p className="text-xs text-gray-500">ステップ {currentStep}/{totalSteps}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* オンボーディング進捗バー */}
      {isOnboarding && (
        <div className="max-w-2xl mx-auto px-4 pt-4">
          <div className="flex items-center gap-2">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  i < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          {onboardingStep === 'password' && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🔐</span>
                <div>
                  <p className="font-medium text-amber-800">パスワードの変更を推奨</p>
                  <p className="text-sm text-amber-700 mt-1">
                    セキュリティ向上のため、初回ログイン時にパスワードの変更をお願いしています。
                  </p>
                </div>
              </div>
            </div>
          )}
          {onboardingStep === 'profile' && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <div className="flex items-start gap-3">
                <span className="text-2xl">👋</span>
                <div>
                  <p className="font-medium text-blue-800">ようこそ！</p>
                  <p className="text-sm text-blue-700 mt-1">
                    プロフィールを登録して、サービスを始めましょう。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* タブナビゲーション（オンボーディング時以外） */}
      {!isOnboarding && (
        <div className="max-w-2xl mx-auto px-4 pt-4">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* メインコンテンツ */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="space-y-4">
          
          {/* プロフィールタブ or オンボーディング（profile） */}
          {(activeTab === 'profile' || onboardingStep === 'profile') && onboardingStep !== 'password' && (
            <>
              {/* アバターカード */}
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex flex-col items-center">
                  <img 
                    src={avatarUrl} 
                    alt="avatar" 
                    className="w-24 h-24 rounded-full ring-4 ring-gray-100 shadow-sm"
                  />
                  <p className="mt-3 text-lg font-semibold text-gray-900">
                    {displayName || '名前未設定'}
                  </p>
                  <p className="text-sm text-gray-500">{email}</p>
                  
                  <button
                    onClick={() => setShowAvatarSettings(!showAvatarSettings)}
                    className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <span>🎨</span>
                    <span>アバターをカスタマイズ</span>
                    <span className={`transition-transform ${showAvatarSettings ? 'rotate-180' : ''}`}>▼</span>
                  </button>
                  
                  {showAvatarSettings && (
                    <div className="mt-4 w-full pt-4 border-t space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">シード文字列</label>
                        <input
                          type="text"
                          value={avatarSeed}
                          onChange={(e) => setAvatarSeed(e.target.value)}
                          placeholder={displayName || userProfile.uid}
                          className="w-full px-4 py-3 min-h-[48px] text-base border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1.5 text-xs text-gray-500">
                          💡 この文字列を元にアバターが生成されます
                        </p>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">背景色</label>
                        <div className="flex gap-3 items-center">
                          <div className="flex-1 relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">#</span>
                            <input
                              type="text"
                              value={avatarBackgroundColor}
                              onChange={(e) => setAvatarBackgroundColor(e.target.value.replace('#', ''))}
                              placeholder="空欄でグラデーション"
                              className="w-full pl-8 pr-4 py-3 min-h-[48px] text-base border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <input
                            type="color"
                            value={avatarBackgroundColor ? `#${avatarBackgroundColor}` : '#3B82F6'}
                            onChange={(e) => setAvatarBackgroundColor(e.target.value.substring(1))}
                            className="w-14 h-12 border rounded-lg cursor-pointer"
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-gray-500">
                          💡 空欄の場合はグラデーション背景になります
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 基本情報カード */}
              <SettingCard
                icon="👤"
                title="基本情報"
                description="あなたの基本的なプロフィール情報"
              >
                <div className="space-y-4">
                  <InputField
                    label="表示名"
                    required
                    value={displayName}
                    onChange={setDisplayName}
                    placeholder="例: 山田 太郎"
                    maxLength={20}
                    helpText="20文字以内で入力してください"
                  />
                  
                  <InputField
                    label="メールアドレス"
                    type="email"
                    value={email}
                    onChange={() => {}}
                    disabled
                    helpText="メールアドレスは変更できません"
                  />
                  
                  <InputField
                    label="電話番号"
                    type="tel"
                    value={phoneNumber}
                    onChange={setPhoneNumber}
                    placeholder="例: 090-1234-5678"
                  />
                </div>
              </SettingCard>
            </>
          )}

          {/* セキュリティタブ or オンボーディング（password） */}
          {(activeTab === 'security' || onboardingStep === 'password') && (
            <SettingCard
              icon="🔒"
              title="パスワード変更"
              description="アカウントのパスワードを変更します"
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    現在のパスワード
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="現在のパスワード"
                      className="w-full px-4 py-3 pr-12 min-h-[48px] text-base border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    >
                      {showCurrentPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    新しいパスワード
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="6文字以上"
                      className="w-full px-4 py-3 pr-12 min-h-[48px] text-base border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    >
                      {showNewPassword ? '🙈' : '👁️'}
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">
                    💡 6文字以上で設定してください
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    新しいパスワード（確認）
                  </label>
                  <input
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="もう一度入力"
                    className="w-full px-4 py-3 min-h-[48px] text-base border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {newPassword && confirmNewPassword && newPassword !== confirmNewPassword && (
                    <p className="mt-1.5 text-xs text-red-500">
                      ⚠️ パスワードが一致しません
                    </p>
                  )}
                  {newPassword && confirmNewPassword && newPassword === confirmNewPassword && (
                    <p className="mt-1.5 text-xs text-green-600">
                      ✓ パスワードが一致しています
                    </p>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  {onboardingStep === 'password' && (
                    <button
                      onClick={skipPasswordChange}
                      className="flex-1 px-4 py-3 min-h-[48px] text-base font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                    >
                      スキップ
                    </button>
                  )}
                  <button
                    onClick={handlePasswordChange}
                    disabled={changingPassword || !currentPassword || !newPassword || !confirmNewPassword || newPassword !== confirmNewPassword}
                    className={`flex-1 px-4 py-3 min-h-[48px] text-base font-medium rounded-lg transition-colors ${
                      changingPassword || !currentPassword || !newPassword || !confirmNewPassword || newPassword !== confirmNewPassword
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {changingPassword ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        変更中...
                      </span>
                    ) : 'パスワードを変更'}
                  </button>
                </div>
              </div>
            </SettingCard>
          )}
        </div>
      </main>

      {/* 固定フッター（プロフィールタブ時のみ） */}
      {(activeTab === 'profile' || onboardingStep === 'profile') && onboardingStep !== 'password' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg safe-area-pb">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-gray-500 hidden sm:block">
                {hasChanges ? (
                  <span className="flex items-center gap-1.5 text-amber-600">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    未保存の変更があります
                  </span>
                ) : (
                  <span className="text-gray-400">変更なし</span>
                )}
              </div>
              <button
                onClick={save}
                disabled={saving || (!hasChanges && !isOnboarding)}
                className={`flex-1 sm:flex-none px-8 py-3 min-h-[48px] text-base font-medium rounded-lg transition-all ${
                  saving || (!hasChanges && !isOnboarding)
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                }`}
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    保存中...
                  </span>
                ) : (isOnboarding ? '登録して始める' : '保存する')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}