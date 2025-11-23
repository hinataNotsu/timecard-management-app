'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Organization } from '@/types';
import toast from 'react-hot-toast';

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
  const [shiftSubmissionCycle, setShiftSubmissionCycle] = useState<'weekly' | 'biweekly' | 'monthly'>('monthly');
  const [weekStartDay, setWeekStartDay] = useState<number>(1); // 1=月曜
  const [weeklyDeadlineDaysBefore, setWeeklyDeadlineDaysBefore] = useState<number>(3);
  const [monthlyDeadlineDay, setMonthlyDeadlineDay] = useState<number>(25);
  const [isWatchAdmin, setIsWatchAdmin] = useState<boolean>(true);
  const [showWatchAdminDialog, setShowWatchAdminDialog] = useState<boolean>(false);
  const [pendingWatchAdminValue, setPendingWatchAdminValue] = useState<boolean>(true);
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
        setShiftSubmissionCycle(org.shiftSubmissionCycle ?? 'monthly');
        setWeekStartDay(org.weekStartDay ?? 1);
        setWeeklyDeadlineDaysBefore(org.weeklyDeadlineDaysBefore ?? 3);
        setMonthlyDeadlineDay(org.monthlyDeadlineDay ?? 25);
        setIsWatchAdmin(org.isWatchAdmin ?? true);
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
      toast.error('時給は1以上を入力してください');
      return;
    }
    if (settings.nightPremiumEnabled) {
      if (settings.nightPremiumRate < 0 || settings.nightPremiumRate > 2) {
        toast.error('深夜割増率は0〜2の範囲で指定してください（例: 0.25 = 25%）');
        return;
      }
      const hhmm = /^\d{2}:\d{2}$/;
      if (!hhmm.test(settings.nightStart) || !hhmm.test(settings.nightEnd)) {
        toast.error('深夜時間はHH:mm形式で入力してください');
        return;
      }
    }
    if (settings.overtimePremiumEnabled) {
      if (settings.overtimePremiumRate < 0 || settings.overtimePremiumRate > 2) {
        toast.error('残業割増率は0〜2の範囲で指定してください');
        return;
      }
      if (settings.overtimeDailyThresholdMinutes < 0 || settings.overtimeDailyThresholdMinutes > 1440) {
        toast.error('残業閾値（分）は0〜1440の範囲で指定してください');
        return;
      }
    }
    if (settings.holidayPremiumEnabled) {
      if (settings.holidayPremiumRate < 0 || settings.holidayPremiumRate > 2) {
        toast.error('休日割増率は0〜2の範囲で指定してください');
        return;
      }
    }
    if (settings.transportAllowanceEnabled) {
      if (settings.transportAllowancePerShift < 0) {
        toast.error('交通費は0以上で指定してください');
        return;
      }
    }
    // シフト提出ルールのバリデーション
    if (shiftSubmissionCycle === 'weekly' || shiftSubmissionCycle === 'biweekly') {
      if (weeklyDeadlineDaysBefore < 1 || weeklyDeadlineDaysBefore > 30) {
        toast.error('締切日数は1〜30の範囲で指定してください');
        return;
      }
    }
    if (shiftSubmissionCycle === 'monthly') {
      if (monthlyDeadlineDay < 1 || monthlyDeadlineDay > 31) {
        toast.error('締切日は1〜31の範囲で指定してください');
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
          shiftSubmissionCycle: shiftSubmissionCycle,
          weekStartDay: weekStartDay,
          weeklyDeadlineDaysBefore: weeklyDeadlineDaysBefore,
          monthlyDeadlineDay: monthlyDeadlineDay,
          isWatchAdmin: isWatchAdmin,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      // 保存後はダッシュボードへ戻る
      router.push('/company/dashboard');
    } catch (e) {
      console.error('[Org Settings] save error', e);
      toast.error('保存に失敗しました');
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
                  💡 各ユーザーの交通費は<button onClick={() => router.push('/company/members')} className="underline font-semibold hover:text-blue-900">ユーザー一覧設定</button>で個別に設定できます。
                </p>
              </div>
            )}
          </div>

          {/* シフト提出ルール */}
          <hr className="my-2" />
          <h3 className="text-md font-semibold text-gray-900">シフト提出ルール</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">提出サイクル</label>
              <select
                value={shiftSubmissionCycle}
                onChange={(e) => setShiftSubmissionCycle(e.target.value as 'weekly' | 'biweekly' | 'monthly')}
                disabled={!canEdit}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="weekly">1週間ごと</option>
                <option value="biweekly">2週間ごと</option>
                <option value="monthly">1ヶ月ごと</option>
              </select>
            </div>

            {(shiftSubmissionCycle === 'weekly' || shiftSubmissionCycle === 'biweekly') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-blue-50 p-4 rounded-lg">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">週の開始日</label>
                  <select
                    value={weekStartDay}
                    onChange={(e) => setWeekStartDay(Number(e.target.value))}
                    disabled={!canEdit}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={0}>日曜日</option>
                    <option value={1}>月曜日</option>
                    <option value={2}>火曜日</option>
                    <option value={3}>水曜日</option>
                    <option value={4}>木曜日</option>
                    <option value={5}>金曜日</option>
                    <option value={6}>土曜日</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">締切（週開始の何日前）</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={weeklyDeadlineDaysBefore}
                    onChange={(e) => setWeeklyDeadlineDaysBefore(Number(e.target.value))}
                    disabled={!canEdit}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 3"
                  />
                  <p className="mt-1 text-xs text-gray-600">
                    例: 3日前 → 週開始日の3日前までに提出
                  </p>
                </div>
              </div>
            )}

            {shiftSubmissionCycle === 'monthly' && (
              <div className="bg-green-50 p-4 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-1">締切日（毎月何日まで）</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={monthlyDeadlineDay}
                  onChange={(e) => setMonthlyDeadlineDay(Number(e.target.value))}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: 25"
                />
                <p className="mt-1 text-xs text-gray-600">
                  例: 25日 → 毎月25日までに翌月のシフトを提出
                </p>
              </div>
            )}
          </div>

          {/* タイムカード表示設定 */}
          <hr className="my-2" />
          <h3 className="text-md font-semibold text-gray-900">タイムカード表示設定</h3>
          <div className="grid grid-cols-1 gap-6">
            <div className="flex items-center justify-between bg-gray-50 p-4 rounded-lg">
              <div>
                <label htmlFor="watchAdmin" className="text-sm font-medium text-gray-900">管理者ダッシュボードにタイムカードを表示</label>
                <p className="text-xs text-gray-600 mt-1">有効にすると管理者がスタッフのタイムカードを編集できます。無効にするとアルバイトが個別に記録します。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingWatchAdminValue(!isWatchAdmin);
                  setShowWatchAdminDialog(true);
                }}
                disabled={!canEdit}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  isWatchAdmin ? 'bg-blue-600' : 'bg-gray-200'
                } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isWatchAdmin ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
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

      {/* タイムカード表示設定変更ダイアログ */}
      {showWatchAdminDialog && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">タイムカード表示設定の変更</h3>
            <p className="text-sm text-gray-700 mb-6">
              {pendingWatchAdminValue
                ? '管理者ダッシュボードにタイムカードを表示します。管理者がスタッフのタイムカードを作成・編集できるようになります。'
                : 'アルバイトダッシュボードにタイムカードを表示します。各アルバイトが個別に出退勤を記録します。'}
            </p>
            <p className="text-sm text-yellow-700 bg-yellow-50 p-3 rounded mb-6">
              ⚠️ この設定を変更すると、タイムカードの記録方法が変わります。よろしいですか？
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowWatchAdminDialog(false)}
                className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  setIsWatchAdmin(pendingWatchAdminValue);
                  setShowWatchAdminDialog(false);
                }}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                変更する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
