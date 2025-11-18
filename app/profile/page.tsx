'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential, deleteUser } from 'firebase/auth';

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
  
  // パスワード変更用
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  
  // アカウント削除用
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

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
        } else {
          setDisplayName(userProfile.displayName || '');
          setEmail(userProfile.email || '');
          setAvatarSeed(userProfile.displayName || userProfile.uid);
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
      alert('表示名を入力してください');
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', userProfile.uid), {
        displayName: displayName.trim(),
        phoneNumber: phoneNumber.trim(),
        avatarSeed: avatarSeed.trim() || displayName.trim() || userProfile.uid,
        avatarBackgroundColor: avatarBackgroundColor.trim(),
        updatedAt: Timestamp.now(),
      } as any);
      alert('保存しました');
      router.back();
    } catch (e) {
      console.error('[Profile] save error', e);
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!auth.currentUser || !userProfile) return;
    
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      alert('全ての項目を入力してください');
      return;
    }
    
    if (newPassword !== confirmNewPassword) {
      alert('新しいパスワードが一致しません');
      return;
    }
    
    if (newPassword.length < 6) {
      alert('パスワードは6文字以上で入力してください');
      return;
    }
    
    setChangingPassword(true);
    try {
      // 再認証
      const credential = EmailAuthProvider.credential(userProfile.email || '', currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      
      // パスワード更新
      await updatePassword(auth.currentUser, newPassword);
      
      alert('パスワードを変更しました');
      setShowPasswordChange(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (e: any) {
      console.error('[Profile] password change error', e);
      if (e.code === 'auth/wrong-password') {
        alert('現在のパスワードが正しくありません');
      } else if (e.code === 'auth/too-many-requests') {
        alert('試行回数が多すぎます。しばらく待ってから再度お試しください');
      } else {
        alert('パスワードの変更に失敗しました');
      }
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!auth.currentUser || !userProfile) return;
    
    if (!deletePassword) {
      alert('パスワードを入力してください');
      return;
    }
    
    if (deleteConfirmText !== '削除') {
      alert('「削除」と入力してください');
      return;
    }
    
    if (!confirm('本当にアカウントを削除しますか？\n\nこの操作は取り消せません。アカウントは無効化され、ログインできなくなります。\n\n※ 過去のシフトやタイムカードは企業側に記録として残ります。')) {
      return;
    }
    
    setDeleting(true);
    try {
      // 再認証
      const credential = EmailAuthProvider.credential(userProfile.email || '', deletePassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      
      // Firestoreデータを論理削除（deleted: trueフラグを設定）
      await updateDoc(doc(db, 'users', userProfile.uid), {
        deleted: true,
        deletedAt: Timestamp.now(),
        organizationIds: [], // 全ての組織から離脱
        updatedAt: Timestamp.now(),
      });
      
      // 全ての組織のmembersサブコレクションから削除
      if (userProfile.organizationIds && userProfile.organizationIds.length > 0) {
        for (const orgId of userProfile.organizationIds) {
          try {
            await deleteDoc(doc(db, 'organizations', orgId, 'members', userProfile.uid));
          } catch (e) {
            console.warn('[Profile] failed to remove from org members', orgId, e);
          }
        }
      }
      
      // Firebase Authenticationアカウントを削除
      await deleteUser(auth.currentUser);
      
      alert('アカウントを削除しました。過去の勤怠記録は企業側に保持されます。');
      window.location.href = '/';
    } catch (e: any) {
      console.error('[Profile] delete account error', e);
      if (e.code === 'auth/wrong-password') {
        alert('パスワードが正しくありません');
      } else if (e.code === 'auth/too-many-requests') {
        alert('試行回数が多すぎます。しばらく待ってから再度お試しください');
      } else {
        alert('アカウントの削除に失敗しました');
      }
    } finally {
      setDeleting(false);
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
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700">戻る</button>
            <h1 className="text-2xl font-bold text-gray-900">プロフィール編集</h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img src={avatarUrl(avatarSeed || displayName || userProfile.uid, avatarBackgroundColor)} alt="avatar" className="w-16 h-16 rounded-full ring-1 ring-gray-200" />
              <div>
                <p className="text-sm text-gray-600">プレビュー（DiceBear）</p>
                <p className="text-xs text-gray-500">表示名/シードを変更すると自動で更新されます</p>
              </div>
            </div>
            <button
              onClick={save}
              disabled={saving}
              className={`px-4 py-2 rounded ${saving ? 'bg-gray-300 text-gray-600' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">表示名</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例: 山田 太郎"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メール（変更不可）</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full px-3 py-2 border rounded bg-gray-50 text-gray-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">電話番号（任意）</label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例: 090-1234-5678"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">アバターシード（任意）</label>
            <input
              type="text"
              value={avatarSeed}
              onChange={(e) => setAvatarSeed(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
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

        {/* パスワード変更セクション */}
        <div className="mt-4 bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">パスワード変更</h2>
            <button
              onClick={() => setShowPasswordChange(!showPasswordChange)}
              className="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              {showPasswordChange ? '閉じる' : '変更する'}
            </button>
          </div>
          
          {showPasswordChange && (
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
              
              <div className="flex justify-end">
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

        {/* アカウント削除セクション */}
        <div className="mt-4 bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-red-600">アカウント削除</h2>
              <p className="text-sm text-gray-600 mt-1">この操作は取り消せません</p>
            </div>
            <button
              onClick={() => setShowDeleteAccount(!showDeleteAccount)}
              className="px-3 py-1 text-sm rounded bg-red-100 hover:bg-red-200 text-red-700"
            >
              {showDeleteAccount ? '閉じる' : '削除する'}
            </button>
          </div>
          
          {showDeleteAccount && (
            <div className="space-y-4 pt-4 border-t border-red-200">
              <div className="bg-red-50 border border-red-200 rounded p-3">
                <p className="text-sm text-red-800">
                  ⚠️ アカウントを削除すると、全てのデータが完全に削除されます。この操作は取り消せません。
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="パスワードを入力"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">確認のため「削除」と入力してください</label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="削除"
                />
              </div>
              
              <div className="flex justify-end">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className={`px-4 py-2 rounded ${deleting ? 'bg-gray-300 text-gray-600' : 'bg-red-600 hover:bg-red-700 text-white'}`}
                >
                  {deleting ? '削除中...' : 'アカウントを削除'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
