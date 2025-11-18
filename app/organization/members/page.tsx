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
    if (!confirm(`${displayName} を組織から削除しますか？\n\n※ ユーザーアカウント自体は削除されず、この組織へのアクセス権のみが削除されます。`)) return;
    
    setRemoving(uid);
    try {
      // users/{uid} から organizationIds を削除
      await updateDoc(doc(db, 'users', uid), {
        organizationIds: arrayRemove(orgId),
        updatedAt: Timestamp.now(),
      });

      // メンバー設定も削除
      await deleteDoc(doc(db, 'organizations', orgId, 'members', uid));

      // UI から削除
      setRows(prev => prev.filter(r => r.uid !== uid));
      alert('組織から削除しました');
    } catch (e) {
      console.error('[Members] remove error', e);
      alert('削除に失敗しました');
    } finally {
      setRemoving(null);
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
          <h1 className="text-2xl font-bold">メンバー管理</h1>
          <button onClick={() => router.push('/dashboard/company')} className="text-sm text-gray-600 hover:text-gray-900">← ダッシュボード</button>
        </div>

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
                      >{removing === r.uid ? '削除中' : '組織から削除'}</button>
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
