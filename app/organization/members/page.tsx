'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDoc, getDocs, query, updateDoc, where, setDoc, deleteDoc, Timestamp, arrayRemove } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface MemberRow {
  uid: string;
  displayName: string;
  email: string;
  avatarSeed?: string;
  avatarBgColor?: string;
  transportAllowancePerShift?: number;
  hourlyWage?: number;
}

export default function OrganizationMembersPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  
  // ユーザー追加用
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserDisplayName, setNewUserDisplayName] = useState('');
  const [adding, setAdding] = useState(false);

  const orgId = userProfile?.currentOrganizationId;

  useEffect(() => {
    if (!userProfile) return;
    if (!userProfile.isManage) {
      router.push('/dashboard/part-time');
      return;
    }
  }, [userProfile, router]);

  useEffect(() => {
    const load = async () => {
      if (!orgId) return;
      setLoading(true);
      try {
        // 組織メンバー = users から array-contains で取得
        const uq = query(collection(db, 'users'), where('organizationIds', 'array-contains', orgId));
        const usnap = await getDocs(uq);

        // 組織デフォルト時給を取得
        let orgDefaultWage: number | null = null;
        try {
          const orgSnap = await getDoc(doc(db, 'organizations', orgId));
          if (orgSnap.exists()) {
            const dw = (orgSnap.data() as any).defaultHourlyWage;
            orgDefaultWage = typeof dw === 'number' ? dw : (Number(dw) || null);
          }
        } catch {}

        // メンバー個別設定を取得
        const memberSnap = await getDocs(collection(db, 'organizations', orgId, 'members'));
        const settingsMap = new Map<string, { transport?: number; wage?: number }>();
        memberSnap.forEach((d) => {
          const data = d.data() as any;
          settingsMap.set(d.id, {
            transport: typeof data.transportAllowancePerShift === 'number' ? data.transportAllowancePerShift : undefined,
            wage: typeof data.hourlyWage === 'number' ? data.hourlyWage : undefined,
          });
        });

        // membersサブコレクションにないユーザーのドキュメントを自動作成
        const memberIds = new Set(memberSnap.docs.map(d => d.id));
        for (const userDoc of usnap.docs) {
          const userId = userDoc.id;
          if (!memberIds.has(userId)) {
            try {
              await setDoc(doc(db, 'organizations', orgId, 'members', userId), {
                transportAllowancePerShift: 0,
                hourlyWage: orgDefaultWage,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
              });
              console.log('[Members] Auto-created member document for', userId);
              settingsMap.set(userId, { transport: 0, wage: undefined });
            } catch (err) {
              console.warn('[Members] Failed to auto-create member document for', userId, err);
            }
          }
        }

        const list: MemberRow[] = usnap.docs.map((d) => {
          const u = d.data() as any;
          const settings = settingsMap.get(d.id);
          return {
            uid: u.uid || d.id,
            displayName: u.displayName || d.id,
            email: u.email || '',
            avatarSeed: u.avatarSeed || u.displayName || d.id,
            avatarBgColor: u.avatarBackgroundColor,
            transportAllowancePerShift: settings?.transport,
            hourlyWage: settings?.wage,
          };
        }).sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));

        setRows(list);
      } catch (e) {
        console.error('[Members] load error', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [orgId]);

  const saveRow = async (uid: string, transport: number | undefined, wage: number | undefined) => {
    if (!orgId) return;
    setSaving(uid);
    try {
      await setDoc(
        doc(db, 'organizations', orgId, 'members', uid),
        {
          transportAllowancePerShift: typeof transport === 'number' ? transport : null,
          hourlyWage: typeof wage === 'number' ? wage : null,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.error('[Members] save error', e);
      alert('保存に失敗しました');
    } finally {
      setSaving(null);
    }
  };

  const removeFromOrg = async (uid: string, displayName: string) => {
    if (!orgId) return;
    if (!confirm(`${displayName} を完全に削除しますか？\n\n※ ユーザーアカウント自体も削除され、ログインできなくなります。\n※ 過去のシフトやタイムカードは記録として残ります。`)) return;
    
    setRemoving(uid);
    try {
      // API経由で削除（Admin SDKを使用）
      const response = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUid: uid,
          adminUid: userProfile?.uid,
          organizationId: orgId,
        }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'ユーザーの削除に失敗しました');
      }

      // UI から削除
      setRows(prev => prev.filter(r => r.uid !== uid));
      alert('ユーザーを削除しました');
    } catch (e: any) {
      console.error('[Members] remove error', e);
      alert(e.message || 'ユーザーの削除に失敗しました');
    } finally {
      setRemoving(null);
    }
  };

  const handleAddUser = async () => {
    if (!orgId || !userProfile?.uid) return;
    
    if (!newUserEmail || !newUserPassword) {
      alert('メールアドレスとパスワードを入力してください');
      return;
    }
    
    if (newUserPassword.length < 6) {
      alert('パスワードは6文字以上で入力してください');
      return;
    }
    
    setAdding(true);
    try {
      // API経由でユーザー作成（Admin SDKを使用）
      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
          displayName: newUserDisplayName || newUserEmail.split('@')[0],
          organizationId: orgId,
          createdByUid: userProfile.uid,
        }),
      });

      const result = await response.json();
      
      if (!response.ok) {
        const errorMsg = result.error || 'ユーザーの作成に失敗しました';
        const details = result.details ? `\n\n詳細: ${result.details}` : '';
        throw new Error(errorMsg + details);
      }

      alert(`ユーザーを作成しました\n\nメール: ${result.email}\n初回ログイン後にパスワード変更を促します。`);
      
      // フォームをリセット
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserDisplayName('');
      setShowAddUser(false);
      
      // リロード
      window.location.reload();
    } catch (e: any) {
      console.error('[Members] add user error', e);
      alert(e.message || 'ユーザーの作成に失敗しました');
    } finally {
      setAdding(false);
    }
  };

  const avatarUrl = (seed: string, bgColor?: string) => {
    const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
    const params = bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear';
    return `${base}${params}&fontWeight=700&radius=50`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">メンバー管理</h1>
            <button
              onClick={() => setShowAddUser(!showAddUser)}
              className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              {showAddUser ? 'キャンセル' : '+ ユーザー追加'}
            </button>
          </div>
          <button onClick={() => router.push('/dashboard/company')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        {showAddUser && (
          <div className="mb-6 bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">新規ユーザー追加</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス *</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="example@company.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">初期パスワード *（6文字以上）</label>
                <input
                  type="password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="初期パスワード"
                />
                <p className="mt-1 text-xs text-gray-500">※ ユーザーには初回ログイン時にパスワード変更を促します</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">表示名（任意）</label>
                <input
                  type="text"
                  value={newUserDisplayName}
                  onChange={(e) => setNewUserDisplayName(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="山田 太郎"
                                  maxLength={30}
                />
                <p className="mt-1 text-xs text-gray-500">※ 空欄の場合はメールアドレスから自動生成されます</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddUser}
                  disabled={adding}
                  className={`flex-1 px-4 py-2 rounded ${adding ? 'bg-gray-300 text-gray-600' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  {adding ? '作成中...' : 'ユーザーを作成'}
                </button>
                <button
                  onClick={() => {
                    setShowAddUser(false);
                    setNewUserEmail('');
                    setNewUserPassword('');
                    setNewUserDisplayName('');
                  }}
                  className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 border-b text-left" colSpan={2}>氏名</th>
                <th className="p-2 border-b text-left">メール</th>
                <th className="p-2 border-b text-center">時給（円/h）</th>
                <th className="p-2 border-b text-center">交通費（円/シフト）</th>
                <th className="p-2 border-b text-center" colSpan={2}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-center" colSpan={6}>読み込み中...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="p-4 text-center" colSpan={6}>メンバーがいません</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.uid} className="hover:bg-gray-50">
                    <td className="p-2 border-b w-12">
                      <img src={avatarUrl(r.avatarSeed || r.displayName || r.uid, r.avatarBgColor)} alt={r.displayName} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                    </td>
                    <td className="p-2 border-b">{r.displayName}</td>
                    <td className="p-2 border-b">{r.email}</td>
                    <td className="p-2 border-b text-center">
                      <input
                        type="number"
                        min={0}
                        value={r.hourlyWage ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          const num = v === '' ? undefined : Number(v);
                          setRows(prev => prev.map((x) => x.uid === r.uid ? { ...x, hourlyWage: num } : x));
                        }}
                        className="w-32 px-2 py-1 border rounded text-right"
                        placeholder="例: 1200"
                      />
                    </td>
                    <td className="p-2 border-b text-center">
                      <input
                        type="number"
                        min={0}
                        value={r.transportAllowancePerShift ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          const num = v === '' ? undefined : Number(v);
                          setRows(prev => prev.map((x) => x.uid === r.uid ? { ...x, transportAllowancePerShift: num } : x));
                        }}
                        className="w-32 px-2 py-1 border rounded text-right"
                        placeholder="例: 500"
                      />
                    </td>
                    <td className="p-2 border-b text-center">
                      <button
                        onClick={() => saveRow(r.uid, r.transportAllowancePerShift, r.hourlyWage)}
                        disabled={saving === r.uid}
                        className={`px-3 py-1 rounded text-sm ${saving === r.uid ? 'bg-gray-300 text-gray-500' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                      >{saving === r.uid ? '保存中' : '保存'}</button>
                    </td>
                    <td className="p-2 border-b text-center">
                      <button
                        onClick={() => removeFromOrg(r.uid, r.displayName)}
                        disabled={removing === r.uid}
                        className={`px-3 py-1 rounded text-sm ${removing === r.uid ? 'bg-gray-300 text-gray-500' : 'bg-red-600 text-white hover:bg-red-700'}`}
                      >{removing === r.uid ? '削除中' : 'ユーザー削除'}</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
