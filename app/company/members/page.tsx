"use client";
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { collection, doc, getDoc, getDocs, query, updateDoc, where, setDoc, deleteDoc, Timestamp, arrayRemove, arrayUnion } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/components/Toast';

interface MemberRow {
  uid: string;
  displayName: string;
  email: string;
  avatarSeed?: string;
  avatarBgColor?: string;
  transportAllowancePerShift?: number;
  hourlyWage?: number;
}

interface Request {
  uid: string;
  displayName?: string;
  email?: string;
  createdAt?: any;
}

// ドロップダウンメニュー位置
interface MenuPosition {
  top: number;
  left: number;
}

export default function OrganizationMembersPage() {
  // タブ管理
  const [activeTab, setActiveTab] = useState<'members' | 'requests'>('members');
  
  const { userProfile } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  
  // 申請一覧用のstate
  const [requests, setRequests] = useState<Request[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  
  // モーダル状態管理
  const { showSuccessToast, showErrorToast, showConfirmToast } = useToast();
  
  // ドロップダウンメニュー状態（位置情報付き）
  const [openMenuUid, setOpenMenuUid] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 0, left: 0 });

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

        // 退職済み（deleted: true）のユーザーを除外
        const list: MemberRow[] = usnap.docs
          .filter((d) => {
            const u = d.data() as any;
            return !u.deleted;
          })
          .map((d) => {
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
        setRequests(permissionList);
      } catch (e) {
        console.error('[Requests] load error', e);
      } finally {
        setRequestsLoading(false);
      }
    };
    fetchRequests();
  }, [orgId]);

  // 退職処理
  const markAsRetired = async (uid: string, displayName: string) => {
    const confirmed = await showConfirmToast(`${displayName}さんを退職処理しますか？\n\nこの操作は取り消せません。`, {
      title: '退職処理',
      confirmText: '退職処理',
      cancelText: 'キャンセル',
    });
    if (!confirmed) return;
    
    if (!orgId) return;
    setRemoving(uid);
    try {
      // ユーザードキュメントにdeleted: trueを設定
      await updateDoc(doc(db, 'users', uid), {
        deleted: true,
        deletedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      // ローカル状態からも削除
      setRows((prev) => prev.filter((r) => r.uid !== uid));
      showSuccessToast('退職処理が完了しました');
    } catch (e) {
      console.error('[Members] retire error', e);
      showErrorToast('退職処理に失敗しました');
    } finally {
      setRemoving(null);
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
      showSuccessToast('申請を承認しました');
    } catch (e) {
      console.error('[Requests] approve error', e);
      showErrorToast('申請の承認に失敗しました');
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
      showSuccessToast('申請を削除しました');
    } catch (e) {
      console.error('[Requests] reject error', e);
      showErrorToast('申請の削除に失敗しました');
    }
  };

  const avatarUrl = (seed: string, bgColor?: string) => {
    const base = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;
    const params = bgColor ? `&backgroundColor=${encodeURIComponent(bgColor)}` : '&backgroundType=gradientLinear';
    return `${base}${params}&fontWeight=700&radius=50`;
  };

  // メニューを開く（位置計算付き）
  const handleOpenMenu = (uid: string, event: React.MouseEvent<HTMLButtonElement>) => {
    if (openMenuUid === uid) {
      setOpenMenuUid(null);
      return;
    }
    
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    // ビューポートの高さを取得
    const viewportHeight = window.innerHeight;
    const menuHeight = 100; // メニューの概算高さ
    
    // 下に十分なスペースがあるかチェック
    const spaceBelow = viewportHeight - rect.bottom;
    const showAbove = spaceBelow < menuHeight && rect.top > menuHeight;
    
    setMenuPosition({
      top: showAbove ? rect.top - menuHeight : rect.bottom + 4,
      left: rect.right - 128, // メニュー幅 w-32 = 128px
    });
    setOpenMenuUid(uid);
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
                      <th className="p-2 border-b text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td className="p-4 text-center" colSpan={6}>読み込み中...</td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td className="p-4 text-center" colSpan={6}>在籍メンバーがいません</td></tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={r.uid} className="hover:bg-gray-50">
                          <td className="p-2 border-b w-12">
                            <img src={avatarUrl(r.avatarSeed || r.displayName || r.uid, r.avatarBgColor)} alt={r.displayName} className="w-8 h-8 rounded-full ring-1 ring-gray-200" />
                          </td>
                          <td className="p-2 border-b">{r.displayName}</td>
                          <td className="p-2 border-b">{r.email}</td>
                          <td className="p-2 border-b text-center">
                            {r.hourlyWage ? `¥${r.hourlyWage.toLocaleString()}` : '-'}
                          </td>
                          <td className="p-2 border-b text-center">
                            {r.transportAllowancePerShift ? `¥${r.transportAllowancePerShift.toLocaleString()}` : '-'}
                          </td>
                          <td className="p-2 border-b text-center">
                            <button
                              onClick={(e) => handleOpenMenu(r.uid, e)}
                              className="px-2 py-1 text-gray-600 hover:bg-gray-100 rounded"
                            >
                              ⋮
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
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

      {/* ドロップダウンメニュー（position: fixed で表示） */}
      {openMenuUid && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpenMenuUid(null)} />
          <div 
            className="fixed w-32 bg-white border rounded-lg shadow-lg z-50"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
            }}
          >
            <button
              onClick={() => {
                const uid = openMenuUid;
                setOpenMenuUid(null);
                router.push(`/company/members/${uid}/edit`);
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 rounded-t-lg"
            >
              編集
            </button>
            <button
              onClick={() => {
                const member = rows.find(r => r.uid === openMenuUid);
                if (member) {
                  setOpenMenuUid(null);
                  markAsRetired(member.uid, member.displayName);
                }
              }}
              className="w-full px-4 py-2 text-left text-sm text-amber-600 hover:bg-gray-100 rounded-b-lg"
            >
              退職処理
            </button>
          </div>
        </>
      )}
    </div>
  );
}