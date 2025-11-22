"use client";
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDoc, getDocs, query, updateDoc, where, setDoc, deleteDoc, Timestamp, arrayRemove, arrayUnion } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface MemberRow {
  uid: string;
  displayName: string;
  email: string;
  avatarSeed?: string;
  avatarBgColor?: string;
  transportAllowancePerShift?: number;
  hourlyWage?: number;
  deleted?: boolean;
  deletedAt?: Timestamp;
}

interface Request {
  uid: string;
  displayName?: string;
  email?: string;
  createdAt?: any;
}

export default function OrganizationMembersPage() {
    // タブ管理
    const [activeTab, setActiveTab] = useState<'members' | 'requests'>('members');
    
    // 新規ユーザー追加用のstate（関数コンポーネント内に移動）
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserPassword, setNewUserPassword] = useState('');
    const [newUserDisplayName, setNewUserDisplayName] = useState('');
    const [adding, setAdding] = useState(false);
    const [showAddUser, setShowAddUser] = useState(false);
  const { userProfile } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  
  // 申請一覧用のstate
  const [requests, setRequests] = useState<Request[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  
  // ...existing code...

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
          const memberData = memberSnap.docs.find(m => m.id === d.id)?.data() as any;
          return {
            uid: u.uid || d.id,
            displayName: u.displayName || d.id,
            email: u.email || '',
            avatarSeed: u.avatarSeed || u.displayName || d.id,
            avatarBgColor: u.avatarBackgroundColor,
            transportAllowancePerShift: settings?.transport,
            hourlyWage: settings?.wage,
            deleted: memberData?.deleted || false,
            deletedAt: memberData?.deletedAt,
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

  // 申請一覧を取得
  useEffect(() => {
    if (!orgId) return;
    const fetchRequests = async () => {
      setRequestsLoading(true);
      try {
        const orgDocRef = doc(db, 'organizations', orgId);
        const orgDoc = await getDoc(orgDocRef);
        const orgData = orgDoc.exists() ? orgDoc.data() : {};
        const permissionList = Array.isArray(orgData.permissionList) ? orgData.permissionList : [];
        console.log('[Requests] Loaded permissionList:', permissionList);
        setRequests(permissionList);
      } catch (e) {
        console.error('[Requests] load error', e);
      } finally {
        setRequestsLoading(false);
      }
    };
    fetchRequests();
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

  const markAsRetired = async (uid: string, displayName: string) => {
    if (!orgId) return;
    if (!confirm(`${displayName} をこの組織で退職済みにしますか？\n\n※ この組織でのアクセスができなくなります\n※ 他の組織には影響しません\n※ 過去のシフトやタイムカードは記録として残ります`)) return;
    
    setRemoving(uid);
    try {
      // membersサブコレクションにdeleted: trueを設定
      await updateDoc(doc(db, 'organizations', orgId, 'members', uid), {
        deleted: true,
        deletedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      // UIを更新
      setRows(prev => prev.map(r => 
        r.uid === uid ? { ...r, deleted: true, deletedAt: Timestamp.now() } : r
      ));
      alert('退職処理が完了しました');
    } catch (e: any) {
      console.error('[Members] retire error', e);
      alert('退職処理に失敗しました');
    } finally {
      setRemoving(null);
    }
  };

  const removeFromOrg = async (uid: string, displayName: string) => {
    if (!orgId) return;
    if (!confirm(`${displayName} をこの組織から完全に削除しますか？\n\n※ ユーザーは組織メンバーリストから削除されます\n※ 過去のシフトやタイムカードは記録として残ります`)) return;
    
    setRemoving(uid);
    try {
      // ユーザーのorganizationIdsからこの組織のIDを削除
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        organizationIds: arrayRemove(orgId)
      });

      // UI から削除
      setRows(prev => prev.filter(r => r.uid !== uid));
      alert('ユーザーを組織から削除しました');
    } catch (e: any) {
      console.error('[Members] remove error', e);
      alert('ユーザーの削除に失敗しました');
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
        // Firebase Admin SDK未設定の場合のエラー処理
        if (result.error?.includes('Firebase Admin SDK')) {
          throw new Error('ユーザー作成機能を使用するには、Firebase Admin SDKの設定が必要です。\n\n開発環境では、.env.localに以下を設定してください:\n- FIREBASE_CLIENT_EMAIL\n- FIREBASE_PRIVATE_KEY');
        }
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

  // 申請を承認
  const handleApprove = async (req: Request) => {
    if (!orgId || !req.uid) return;
    try {
      // ユーザーのorganizationIdsに追加
      const userRef = doc(db, 'users', req.uid);
      await updateDoc(userRef, {
        organizationIds: arrayUnion(orgId),
        currentOrganizationId: orgId,
      });
      // permissionListから申請データを削除
      const orgDocRef = doc(db, 'organizations', orgId);
      const orgDoc = await getDoc(orgDocRef);
      const orgData = orgDoc.exists() ? orgDoc.data() : {};
      const permissionList = Array.isArray(orgData.permissionList) ? orgData.permissionList : [];
      const newList = permissionList.filter((p: any) => p.uid !== req.uid);
      await updateDoc(orgDocRef, { permissionList: newList });
      setRequests((prev) => prev.filter((r) => r.uid !== req.uid));
      alert('申請を承認しました');
    } catch (e) {
      console.error('[Requests] approve error', e);
      alert('申請の承認に失敗しました');
    }
  };

  // 申請を削除
  const handleDeleteRequest = async (req: Request) => {
    if (!orgId || !req.uid) return;
    try {
      // permissionListから申請データを削除
      const orgDocRef = doc(db, 'organizations', orgId);
      const orgDoc = await getDoc(orgDocRef);
      const orgData = orgDoc.exists() ? orgDoc.data() : {};
      const permissionList = Array.isArray(orgData.permissionList) ? orgData.permissionList : [];
      const newList = permissionList.filter((p: any) => p.uid !== req.uid);
      await updateDoc(orgDocRef, { permissionList: newList });
      setRequests((prev) => prev.filter((r) => r.uid !== req.uid));
      alert('申請を削除しました');
    } catch (e) {
      console.error('[Requests] reject error', e);
      alert('申請の削除に失敗しました');
    }
  };

  const avatarUrl = (seed: string, bgColor?: string) => {
    const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
    const params = bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear';
    return `${base}${params}&fontWeight=700&radius=50`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">メンバー管理</h1>
          <button onClick={() => router.push('/company/dashboard')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

        {/* タブ */}
        <div className="mb-6 flex gap-2 border-b">
          <button
            onClick={() => setActiveTab('members')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'members'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            メンバー一覧
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className={`px-6 py-3 font-medium transition-colors relative ${
              activeTab === 'requests'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            申請一覧
            {requests.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-red-500 rounded-full">
                {requests.length}
              </span>
            )}
          </button>
        </div>

        {/* メンバー一覧タブ */}
        {activeTab === 'members' && (
          <>
            {/* 在籍メンバー */}
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-3">在籍メンバー</h2>
              <div className="bg-white rounded-lg shadow overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 border-b text-left" colSpan={2}>氏名</th>
                      <th className="p-2 border-b text-left">メール</th>
                      <th className="p-2 border-b text-center">時給（円/h）</th>
                      <th className="p-2 border-b text-center">交通費（円/シフト）</th>
                      <th className="p-2 border-b text-center">保存</th>
                      <th className="p-2 border-b text-center">退職処理</th>
                    </tr>
                  </thead>
                <tbody>
                    {loading ? (
                      <tr><td className="p-4 text-center" colSpan={7}>読み込み中...</td></tr>
                    ) : rows.filter(r => !r.deleted).length === 0 ? (
                      <tr><td className="p-4 text-center" colSpan={7}>在籍メンバーがいません</td></tr>
                    ) : (
                      rows.filter(r => !r.deleted).map((r) => (
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
                            onClick={() => markAsRetired(r.uid, r.displayName)}
                            disabled={removing === r.uid}
                            className={`px-3 py-1 rounded text-sm ${removing === r.uid ? 'bg-gray-300 text-gray-500' : 'bg-amber-600 text-white hover:bg-amber-700'}`}
                          >{removing === r.uid ? '処理中' : '退職処理'}</button>
                        </td>
                      </tr>
                    ))
                  )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 退職済みメンバー */}
            {rows.filter(r => r.deleted).length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3 text-gray-600">退職済みメンバー</h2>
                <div className="bg-gray-50 rounded-lg shadow overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-3 border-b text-left">氏名</th>
                        <th className="p-3 border-b text-left">メールアドレス</th>
                        <th className="p-3 border-b text-center">退職日</th>
                        <th className="p-3 border-b text-center">完全削除</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.filter(r => r.deleted).map(r => (
                        <tr key={r.uid} className="hover:bg-gray-100">
                          <td className="p-2 border-b">
                            <div className="flex items-center gap-2">
                              <img src={avatarUrl(r.avatarSeed || r.displayName, r.avatarBgColor)} alt={r.displayName} className="w-8 h-8 rounded-full" />
                              <span className="text-gray-500">(退職済み) {r.displayName}</span>
                            </div>
                          </td>
                          <td className="p-2 border-b text-gray-500">{r.email}</td>
                          <td className="p-2 border-b text-center text-gray-500">
                            {r.deletedAt?.toDate().toLocaleDateString('ja-JP') || '-'}
                          </td>
                          <td className="p-2 border-b text-center">
                            <button
                              onClick={() => removeFromOrg(r.uid, r.displayName)}
                              disabled={removing === r.uid}
                              className={`px-3 py-1 rounded text-sm ${removing === r.uid ? 'bg-gray-300 text-gray-500' : 'bg-red-600 text-white hover:bg-red-700'}`}
                            >{removing === r.uid ? '削除中' : '完全削除'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* 申請一覧タブ */}
        {activeTab === 'requests' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {requestsLoading ? (
              <p className="p-8 text-center">読み込み中...</p>
            ) : requests.length === 0 ? (
              <p className="p-8 text-center text-gray-500">申請はありません</p>
            ) : (
              <div className="overflow-x-auto overflow-y-hidden">
                <table className="w-full bg-white">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 border-b text-center text-sm md:text-base">ユーザー名</th>
                      <th className="p-2 border-b text-center text-sm md:text-base hidden md:table-cell">メール</th>
                      <th className="p-2 border-b text-center text-sm md:text-base hidden sm:table-cell">申請日時</th>
                      <th className="p-2 border-b text-center text-sm md:text-base">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(req => (
                      <tr key={req.uid} className="hover:bg-gray-50">
                        <td className="p-2 border-b text-center text-sm md:text-base">{req.displayName || req.email || req.uid}</td>
                        <td className="p-2 border-b text-center text-sm md:text-base hidden md:table-cell">{req.email || '-'}</td>
                        <td className="p-2 border-b text-center text-sm md:text-base hidden sm:table-cell">{req.createdAt?.toDate?.() ? req.createdAt.toDate().toLocaleString() : ''}</td>
                        <td className="p-2 border-b text-center">
                          <div className="flex flex-col sm:flex-row gap-2 justify-center">
                            <button className="px-3 py-1 bg-emerald-600 text-white rounded text-sm md:text-base hover:bg-emerald-700" onClick={() => handleApprove(req)}>承認</button>
                            <button className="px-3 py-1 bg-gray-400 text-white rounded text-sm md:text-base hover:bg-gray-500" onClick={() => handleDeleteRequest(req)}>削除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
