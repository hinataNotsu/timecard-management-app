'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Organization } from '@/types';

type OrgPaySettings = Pick<
  Organization,
  | 'defaultHourlyWage'
  | 'nightPremiumEnabled'
  | 'nightPremiumRate'
  | 'nightStart'
  | 'nightEnd'
  | 'overtimePremiumEnabled'
  | 'overtimePremiumRate'
  | 'overtimeDailyThresholdMinutes'
  | 'holidayPremiumEnabled'
  | 'holidayPremiumRate'
  | 'holidayIncludesWeekend'
  | 'transportAllowanceEnabled'
  | 'transportAllowancePerShift'
>;

const defaultSettings: Required<OrgPaySettings> = {
  defaultHourlyWage: 1200,
  nightPremiumEnabled: false,
  nightPremiumRate: 0.25,
  nightStart: '22:00',
  nightEnd: '05:00',
  overtimePremiumEnabled: false,
  overtimePremiumRate: 0.25,
  overtimeDailyThresholdMinutes: 480,
  holidayPremiumEnabled: false,
  holidayPremiumRate: 0.35,
  holidayIncludesWeekend: true,
  transportAllowanceEnabled: false,
  transportAllowancePerShift: 0,
};

export default function OrganizationSettingsPage() {
  const router = useRouter();
  const { userProfile, loading } = useAuth();
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [settings, setSettings] = useState<Required<OrgPaySettings>>(defaultSettings);
  const [shiftSubmissionEnforced, setShiftSubmissionEnforced] = useState<boolean>(false);
  const [shiftSubmissionMinDaysBefore, setShiftSubmissionMinDaysBefore] = useState<number>(3);
  const [loaded, setLoaded] = useState(false);
  const isManager = !!userProfile?.isManage;

  const orgId = userProfile?.currentOrganizationId;

  useEffect(() => {
    if (loading) return;
    if (!userProfile) {
      router.push('/login/company');
      return;
    }
    if (!orgId) {
      router.push('/join-organization');
      return;
    }

    const fetchOrg = async () => {
      const snap = await getDoc(doc(db, 'organizations', orgId));
      if (snap.exists()) {
        const org = snap.data() as Organization;
        setOrgName(org.name || '');
        setSettings({
          defaultHourlyWage: org.defaultHourlyWage ?? defaultSettings.defaultHourlyWage,
          nightPremiumEnabled: org.nightPremiumEnabled ?? defaultSettings.nightPremiumEnabled,
          nightPremiumRate: org.nightPremiumRate ?? defaultSettings.nightPremiumRate,
          nightStart: org.nightStart ?? defaultSettings.nightStart,
          nightEnd: org.nightEnd ?? defaultSettings.nightEnd,
          overtimePremiumEnabled: org.overtimePremiumEnabled ?? defaultSettings.overtimePremiumEnabled,
          overtimePremiumRate: org.overtimePremiumRate ?? defaultSettings.overtimePremiumRate,
          overtimeDailyThresholdMinutes: org.overtimeDailyThresholdMinutes ?? defaultSettings.overtimeDailyThresholdMinutes,
          holidayPremiumEnabled: org.holidayPremiumEnabled ?? defaultSettings.holidayPremiumEnabled,
          holidayPremiumRate: org.holidayPremiumRate ?? defaultSettings.holidayPremiumRate,
          holidayIncludesWeekend: org.holidayIncludesWeekend ?? defaultSettings.holidayIncludesWeekend,
          transportAllowanceEnabled: org.transportAllowanceEnabled ?? defaultSettings.transportAllowanceEnabled,
          transportAllowancePerShift: org.transportAllowancePerShift ?? defaultSettings.transportAllowancePerShift,
        });
        setShiftSubmissionEnforced((org as any).shiftSubmissionEnforced ?? false);
        setShiftSubmissionMinDaysBefore(Number((org as any).shiftSubmissionMinDaysBefore ?? 3));
      }
      setLoaded(true);
    };
    fetchOrg();
  }, [loading, userProfile, orgId, router]);

  const handleNumber = (v: string) => (isNaN(Number(v)) ? '' : Number(v));

  const canEdit = isManager;

  const save = async () => {
    if (!orgId) return;
    if (!canEdit) return;
    // バリデーション
    if (settings.defaultHourlyWage <= 0) {
      alert('時給は1以上を入力してください');
      return;
    }
    if (settings.nightPremiumEnabled) {
      if (settings.nightPremiumRate < 0 || settings.nightPremiumRate > 2) {
        alert('深夜割増率は0〜2の範囲で指定してください（例: 0.25 = 25%）');
        return;
      }
      const hhmm = /^\d{2}:\d{2}$/;
      if (!hhmm.test(settings.nightStart) || !hhmm.test(settings.nightEnd)) {
        alert('深夜時間はHH:mm形式で入力してください');
        return;
      }
    }
    if (settings.overtimePremiumEnabled) {
      if (settings.overtimePremiumRate < 0 || settings.overtimePremiumRate > 2) {
        alert('残業割増率は0〜2の範囲で指定してください');
        return;
      }
      if (settings.overtimeDailyThresholdMinutes < 0 || settings.overtimeDailyThresholdMinutes > 1440) {
        alert('残業閾値（分）は0〜1440の範囲で指定してください');
        return;
      }
    }
    if (settings.holidayPremiumEnabled) {
      if (settings.holidayPremiumRate < 0 || settings.holidayPremiumRate > 2) {
        alert('休日割増率は0〜2の範囲で指定してください');
        return;
      }
    }
    if (settings.transportAllowanceEnabled) {
      if (settings.transportAllowancePerShift < 0) {
        alert('交通費は0以上で指定してください');
        return;
      }
    }
    if (shiftSubmissionEnforced) {
      if (shiftSubmissionMinDaysBefore < 0 || shiftSubmissionMinDaysBefore > 365) {
        alert('提出締切（日数）は0〜365の範囲で指定してください');
        return;
      }
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, 'organizations', orgId),
        {
          // name はここでは更新しない（別UIを想定）。
          defaultHourlyWage: settings.defaultHourlyWage,
          nightPremiumEnabled: settings.nightPremiumEnabled,
          nightPremiumRate: settings.nightPremiumRate,
          nightStart: settings.nightStart,
          nightEnd: settings.nightEnd,
          overtimePremiumEnabled: settings.overtimePremiumEnabled,
          overtimePremiumRate: settings.overtimePremiumRate,
          overtimeDailyThresholdMinutes: settings.overtimeDailyThresholdMinutes,
          holidayPremiumEnabled: settings.holidayPremiumEnabled,
          holidayPremiumRate: settings.holidayPremiumRate,
          holidayIncludesWeekend: settings.holidayIncludesWeekend,
          transportAllowanceEnabled: settings.transportAllowanceEnabled,
          transportAllowancePerShift: settings.transportAllowancePerShift,
          shiftSubmissionEnforced: shiftSubmissionEnforced,
          shiftSubmissionMinDaysBefore: shiftSubmissionMinDaysBefore,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      // 保存後はダッシュボードへ戻る
      router.push('/dashboard/company');
    } catch (e) {
      console.error('[Org Settings] save error', e);
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
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

  if (!userProfile || !orgId) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">企業設定</h1>
            <p className="text-sm text-gray-600">{orgName}</p>
          </div>
          <button
            onClick={() => router.back()}
            className="px-3 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
          >戻る</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">給与設定</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">デフォルト時給（円）</label>
              <input
                type="number"
                min={1}
                value={settings.defaultHourlyWage}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, defaultHourlyWage: Number(e.target.value) }))
                }
                disabled={!canEdit}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 1100"
              />
            </div>

            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <input
                  id="nightEnabled"
                  type="checkbox"
                  checked={settings.nightPremiumEnabled}
                  onChange={(e) => setSettings((s) => ({ ...s, nightPremiumEnabled: e.target.checked }))}
                  disabled={!canEdit}
                  className="h-4 w-4"
                />
                <label htmlFor="nightEnabled" className="text-sm font-medium text-gray-700">深夜割増を適用</label>
              </div>
            </div>
          </div>

          <div className={`grid grid-cols-1 md:grid-cols-3 gap-6 ${settings.nightPremiumEnabled ? '' : 'opacity-50'}`}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">深夜割増率</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={2}
                  value={settings.nightPremiumRate}
                  onChange={(e) => setSettings((s) => ({ ...s, nightPremiumRate: Number(e.target.value) }))}
                  disabled={!canEdit || !settings.nightPremiumEnabled}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-gray-600">(0.25 = 25%)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">深夜開始</label>
              <input
                type="time"
                value={settings.nightStart}
                onChange={(e) => setSettings((s) => ({ ...s, nightStart: e.target.value }))}
                disabled={!canEdit || !settings.nightPremiumEnabled}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">深夜終了</label>
              <input
                type="time"
                value={settings.nightEnd}
                onChange={(e) => setSettings((s) => ({ ...s, nightEnd: e.target.value }))}
                disabled={!canEdit || !settings.nightPremiumEnabled}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 残業割増 */}
          <hr className="my-2" />
          <h3 className="text-md font-semibold text-gray-900">残業割増</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <input
                  id="otEnabled"
                  type="checkbox"
                  checked={settings.overtimePremiumEnabled}
                  onChange={(e) => setSettings((s) => ({ ...s, overtimePremiumEnabled: e.target.checked }))}
                  disabled={!canEdit}
                  className="h-4 w-4"
                />
                <label htmlFor="otEnabled" className="text-sm font-medium text-gray-700">残業割増を適用</label>
              </div>
            </div>
            <div className={`${settings.overtimePremiumEnabled ? '' : 'opacity-50'}`}>
              <label className="block text-sm font-medium text-gray-700 mb-1">残業割増率</label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={2}
                value={settings.overtimePremiumRate}
                onChange={(e) => setSettings((s) => ({ ...s, overtimePremiumRate: Number(e.target.value) }))}
                disabled={!canEdit || !settings.overtimePremiumEnabled}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className={`${settings.overtimePremiumEnabled ? '' : 'opacity-50'}`}>
              <label className="block text-sm font-medium text-gray-700 mb-1">1日あたり閾値（分）</label>
              <input
                type="number"
                min={0}
                max={1440}
                value={settings.overtimeDailyThresholdMinutes}
                onChange={(e) => setSettings((s) => ({ ...s, overtimeDailyThresholdMinutes: Number(e.target.value) }))}
                disabled={!canEdit || !settings.overtimePremiumEnabled}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 480 (8時間)"
              />
            </div>
          </div>

          {/* 休日割増 */}
          <hr className="my-2" />
          <h3 className="text-md font-semibold text-gray-900">休日割増</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-end gap-3">
              <div className="flex items-center gap-2">
                <input
                  id="holidayEnabled"
                  type="checkbox"
                  checked={settings.holidayPremiumEnabled}
                  onChange={(e) => setSettings((s) => ({ ...s, holidayPremiumEnabled: e.target.checked }))}
                  disabled={!canEdit}
                  className="h-4 w-4"
                />
                <label htmlFor="holidayEnabled" className="text-sm font-medium text-gray-700">休日割増を適用</label>
              </div>
            </div>
            <div className={`${settings.holidayPremiumEnabled ? '' : 'opacity-50'}`}>
              <label className="block text-sm font-medium text-gray-700 mb-1">休日割増率</label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={2}
                value={settings.holidayPremiumRate}
                onChange={(e) => setSettings((s) => ({ ...s, holidayPremiumRate: Number(e.target.value) }))}
                disabled={!canEdit || !settings.holidayPremiumEnabled}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className={`${settings.holidayPremiumEnabled ? '' : 'opacity-50'}`}>
              <label className="block text-sm font-medium text-gray-700 mb-1">休日対象</label>
              <div className="flex items-center gap-2">
                <input
                  id="holidayWeekend"
                  type="checkbox"
                  checked={settings.holidayIncludesWeekend}
                  onChange={(e) => setSettings((s) => ({ ...s, holidayIncludesWeekend: e.target.checked }))}
                  disabled={!canEdit || !settings.holidayPremiumEnabled}
                  className="h-4 w-4"
                />
                <label htmlFor="holidayWeekend" className="text-sm text-gray-700">土日も休日扱いにする</label>
              </div>
            </div>
          </div>

          {/* 交通費 */}
          <hr className="my-2" />
          <h3 className="text-md font-semibold text-gray-900">交通費</h3>
          <div className="grid grid-cols-1 gap-6">
            <div className="flex items-center gap-3">
              <input
                id="transEnabled"
                type="checkbox"
                checked={settings.transportAllowanceEnabled}
                onChange={(e) => setSettings((s) => ({ ...s, transportAllowanceEnabled: e.target.checked }))}
                disabled={!canEdit}
                className="h-4 w-4"
              />
              <label htmlFor="transEnabled" className="text-sm font-medium text-gray-700">1シフトあたり交通費を支給</label>
            </div>
            {settings.transportAllowanceEnabled && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  💡 各ユーザーの交通費は<button onClick={() => router.push('/organization/members')} className="underline font-semibold hover:text-blue-900">ユーザー一覧設定</button>で個別に設定できます。
                </p>
              </div>
            )}
          </div>

          {/* シフト提出ルール */}
          <hr className="my-2" />
          <h3 className="text-md font-semibold text-gray-900">シフト提出ルール</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-end gap-3 md:col-span-3">
              <div className="flex items-center gap-2">
                <input
                  id="submitEnforced"
                  type="checkbox"
                  checked={shiftSubmissionEnforced}
                  onChange={(e) => setShiftSubmissionEnforced(e.target.checked)}
                  disabled={!canEdit}
                  className="h-4 w-4"
                />
                <label htmlFor="submitEnforced" className="text-sm font-medium text-gray-700">提出締切を有効にする</label>
              </div>
            </div>
            <div className={`${shiftSubmissionEnforced ? '' : 'opacity-50'}`}>
              <label className="block text-sm font-medium text-gray-700 mb-1">シフト日からの締切（日数）</label>
              <input
                type="number"
                min={0}
                max={365}
                value={shiftSubmissionMinDaysBefore}
                onChange={(e) => setShiftSubmissionMinDaysBefore(Number(e.target.value))}
                disabled={!canEdit || !shiftSubmissionEnforced}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 3 (シフト日の3日前まで)"
              />
              <p className="mt-1 text-xs text-gray-600">例: 3 を設定すると、シフト日の3日前を過ぎると提出/編集/削除ができません（管理者は常に可）。</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={!canEdit || saving}
              className={`px-4 py-2 rounded ${canEdit ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
            >{saving ? '保存中...' : '保存'}</button>
          </div>
        </div>
      </main>
    </div>
  );
}
