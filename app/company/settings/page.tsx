'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Organization } from '@/types';
import { useToast } from '@/components/Toast';

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

type TabType = 'salary' | 'shift' | 'timecard';

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
  enabled,
  onToggle,
  children,
  preview,
  disabled = false,
}: {
  icon: string;
  title: string;
  description: string;
  enabled?: boolean;
  onToggle?: (value: boolean) => void;
  children?: React.ReactNode;
  preview?: React.ReactNode;
  disabled?: boolean;
}) => (
  <div className={`bg-white rounded-xl shadow-sm border transition-all duration-200 ${enabled === false ? 'opacity-60' : ''}`}>
    <div className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{description}</p>
          </div>
        </div>
        {onToggle && (
          <Toggle enabled={enabled ?? false} onChange={onToggle} disabled={disabled} />
        )}
      </div>
      
      {preview && (enabled ?? true) && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
          {preview}
        </div>
      )}
      
      {children && (enabled ?? true) && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          {children}
        </div>
      )}
    </div>
  </div>
);

export default function OrganizationSettingsPage() {
  const router = useRouter();
  const { userProfile, loading } = useAuth();
  const { showSuccessToast, showErrorToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [settings, setSettings] = useState<Required<OrgPaySettings>>(defaultSettings);
  const [shiftSubmissionCycle, setShiftSubmissionCycle] = useState<'weekly' | 'biweekly' | 'monthly'>('monthly');
  const [weekStartDay, setWeekStartDay] = useState<number>(1);
  const [weeklyDeadlineDaysBefore, setWeeklyDeadlineDaysBefore] = useState<number>(3);
  const [monthlyDeadlineDay, setMonthlyDeadlineDay] = useState<number>(25);
  const [isWatchAdmin, setIsWatchAdmin] = useState<boolean>(true);
  const [showWatchAdminDialog, setShowWatchAdminDialog] = useState<boolean>(false);
  const [pendingWatchAdminValue, setPendingWatchAdminValue] = useState<boolean>(true);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('salary');
  const [hasChanges, setHasChanges] = useState(false);
  
  const isManager = !!userProfile?.isManage;
  const orgId = userProfile?.currentOrganizationId;
  const canEdit = isManager;

  // 初期値を保存して変更検知
  const [initialSettings, setInitialSettings] = useState<string>('');

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
        const loadedSettings = {
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
        };
        setSettings(loadedSettings);
        setShiftSubmissionCycle(org.shiftSubmissionCycle ?? 'monthly');
        setWeekStartDay(org.weekStartDay ?? 1);
        setWeeklyDeadlineDaysBefore(org.weeklyDeadlineDaysBefore ?? 3);
        setMonthlyDeadlineDay(org.monthlyDeadlineDay ?? 25);
        setIsWatchAdmin(org.isWatchAdmin ?? true);
        
        // 初期状態を保存
        setInitialSettings(JSON.stringify({
          ...loadedSettings,
          shiftSubmissionCycle: org.shiftSubmissionCycle ?? 'monthly',
          weekStartDay: org.weekStartDay ?? 1,
          weeklyDeadlineDaysBefore: org.weeklyDeadlineDaysBefore ?? 3,
          monthlyDeadlineDay: org.monthlyDeadlineDay ?? 25,
          isWatchAdmin: org.isWatchAdmin ?? true,
        }));
      }
      setLoaded(true);
    };
    fetchOrg();
  }, [loading, userProfile, orgId, router]);

  // 変更検知
  useEffect(() => {
    if (!initialSettings) return;
    const currentState = JSON.stringify({
      ...settings,
      shiftSubmissionCycle,
      weekStartDay,
      weeklyDeadlineDaysBefore,
      monthlyDeadlineDay,
      isWatchAdmin,
    });
    setHasChanges(currentState !== initialSettings);
  }, [settings, shiftSubmissionCycle, weekStartDay, weeklyDeadlineDaysBefore, monthlyDeadlineDay, isWatchAdmin, initialSettings]);

  // プレビュー計算
  const previews = useMemo(() => {
    const base = settings.defaultHourlyWage;
    return {
      nightWage: Math.round(base * (1 + settings.nightPremiumRate)),
      nightBonus: Math.round(base * settings.nightPremiumRate),
      overtimeWage: Math.round(base * (1 + settings.overtimePremiumRate)),
      overtimeBonus: Math.round(base * settings.overtimePremiumRate),
      holidayWage: Math.round(base * (1 + settings.holidayPremiumRate)),
      holidayBonus: Math.round(base * settings.holidayPremiumRate),
      overtimeThresholdHours: Math.floor(settings.overtimeDailyThresholdMinutes / 60),
      overtimeThresholdMins: settings.overtimeDailyThresholdMinutes % 60,
    };
  }, [settings]);

  const save = async () => {
    if (!orgId || !canEdit) return;
    
    // バリデーション
    if (settings.defaultHourlyWage <= 0) {
      showErrorToast('時給は1以上を入力してください');
      return;
    }
    if (settings.nightPremiumEnabled) {
      if (settings.nightPremiumRate < 0 || settings.nightPremiumRate > 2) {
        showErrorToast('深夜割増率は0〜2の範囲で指定してください');
        return;
      }
      const hhmm = /^\d{2}:\d{2}$/;
      if (!hhmm.test(settings.nightStart) || !hhmm.test(settings.nightEnd)) {
        showErrorToast('深夜時間はHH:mm形式で入力してください');
        return;
      }
    }
    if (settings.overtimePremiumEnabled) {
      if (settings.overtimePremiumRate < 0 || settings.overtimePremiumRate > 2) {
        showErrorToast('残業割増率は0〜2の範囲で指定してください');
        return;
      }
      if (settings.overtimeDailyThresholdMinutes < 0 || settings.overtimeDailyThresholdMinutes > 1440) {
        showErrorToast('残業閾値は0〜1440分の範囲で指定してください');
        return;
      }
    }
    if (settings.holidayPremiumEnabled) {
      if (settings.holidayPremiumRate < 0 || settings.holidayPremiumRate > 2) {
        showErrorToast('休日割増率は0〜2の範囲で指定してください');
        return;
      }
    }
    if (settings.transportAllowanceEnabled && settings.transportAllowancePerShift < 0) {
      showErrorToast('交通費は0以上で指定してください');
      return;
    }
    if ((shiftSubmissionCycle === 'weekly' || shiftSubmissionCycle === 'biweekly') && 
        (weeklyDeadlineDaysBefore < 1 || weeklyDeadlineDaysBefore > 30)) {
      showErrorToast('締切日数は1〜30の範囲で指定してください');
      return;
    }
    if (shiftSubmissionCycle === 'monthly' && (monthlyDeadlineDay < 1 || monthlyDeadlineDay > 31)) {
      showErrorToast('締切日は1〜31の範囲で指定してください');
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(db, 'organizations', orgId),
        {
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
          shiftSubmissionCycle,
          weekStartDay,
          weeklyDeadlineDaysBefore,
          monthlyDeadlineDay,
          isWatchAdmin,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      showSuccessToast('設定を保存しました');
      setInitialSettings(JSON.stringify({
        ...settings,
        shiftSubmissionCycle,
        weekStartDay,
        weeklyDeadlineDaysBefore,
        monthlyDeadlineDay,
        isWatchAdmin,
      }));
      setHasChanges(false);
    } catch (e) {
      console.error('[Org Settings] save error', e);
      showErrorToast('保存に失敗しました');
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

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'salary', label: '給与設定', icon: '💰' },
    { id: 'shift', label: 'シフトルール', icon: '📅' },
    { id: 'timecard', label: 'タイムカード', icon: '⏰' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">企業設定</h1>
              <p className="text-sm text-gray-500 mt-0.5">{orgName}</p>
            </div>
            <button
              onClick={() => router.push('/company/dashboard')}
              className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-colors"
            >
              ← 戻る
            </button>
          </div>
        </div>
      </header>

      {/* 設定サマリー */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
          <h2 className="text-sm font-medium text-blue-800 mb-2">現在の設定</h2>
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${settings.nightPremiumEnabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
              {settings.nightPremiumEnabled ? '✓' : '×'} 深夜割増
            </span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${settings.overtimePremiumEnabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
              {settings.overtimePremiumEnabled ? '✓' : '×'} 残業割増
            </span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${settings.holidayPremiumEnabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
              {settings.holidayPremiumEnabled ? '✓' : '×'} 休日割増
            </span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${settings.transportAllowanceEnabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
              {settings.transportAllowanceEnabled ? `✓ 交通費 ¥${settings.transportAllowancePerShift.toLocaleString()}` : '× 交通費'}
            </span>
          </div>
        </div>
      </div>

      {/* タブナビゲーション */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-4">
          
          {/* 給与設定タブ */}
          {activeTab === 'salary' && (
            <>
              {/* 基本時給 */}
              <SettingCard
                icon="💵"
                title="基本時給"
                description="全スタッフのデフォルト時給を設定します"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">¥</span>
                  <input
                    type="number"
                    min={1}
                    value={settings.defaultHourlyWage}
                    onChange={(e) => setSettings(s => ({ ...s, defaultHourlyWage: Number(e.target.value) }))}
                    disabled={!canEdit}
                    className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg font-semibold"
                  />
                  <span className="text-gray-500">/時</span>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  💡 個別の時給は「メンバー管理」から設定できます
                </p>
              </SettingCard>

              {/* 深夜割増 */}
              <SettingCard
                icon="🌙"
                title="深夜割増"
                description="深夜時間帯の割増賃金を設定します"
                enabled={settings.nightPremiumEnabled}
                onToggle={(v) => setSettings(s => ({ ...s, nightPremiumEnabled: v }))}
                disabled={!canEdit}
                preview={settings.nightPremiumEnabled && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-700">深夜時給</span>
                    <span className="font-bold text-blue-900">
                      ¥{previews.nightWage.toLocaleString()}
                      <span className="text-xs font-normal text-blue-600 ml-1">(+¥{previews.nightBonus.toLocaleString()})</span>
                    </span>
                  </div>
                )}
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">割増率</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={2}
                        value={settings.nightPremiumRate}
                        onChange={(e) => setSettings(s => ({ ...s, nightPremiumRate: Number(e.target.value) }))}
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-gray-500 text-sm whitespace-nowrap">= {Math.round(settings.nightPremiumRate * 100)}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">開始時刻</label>
                    <input
                      type="time"
                      value={settings.nightStart}
                      onChange={(e) => setSettings(s => ({ ...s, nightStart: e.target.value }))}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">終了時刻</label>
                    <input
                      type="time"
                      value={settings.nightEnd}
                      onChange={(e) => setSettings(s => ({ ...s, nightEnd: e.target.value }))}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </SettingCard>

              {/* 残業割増 */}
              <SettingCard
                icon="⏱️"
                title="残業割増"
                description="1日の労働時間が閾値を超えた場合の割増を設定します"
                enabled={settings.overtimePremiumEnabled}
                onToggle={(v) => setSettings(s => ({ ...s, overtimePremiumEnabled: v }))}
                disabled={!canEdit}
                preview={settings.overtimePremiumEnabled && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-700">
                      {previews.overtimeThresholdHours}時間{previews.overtimeThresholdMins > 0 && `${previews.overtimeThresholdMins}分`}超過後の時給
                    </span>
                    <span className="font-bold text-blue-900">
                      ¥{previews.overtimeWage.toLocaleString()}
                      <span className="text-xs font-normal text-blue-600 ml-1">(+¥{previews.overtimeBonus.toLocaleString()})</span>
                    </span>
                  </div>
                )}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">割増率</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={2}
                        value={settings.overtimePremiumRate}
                        onChange={(e) => setSettings(s => ({ ...s, overtimePremiumRate: Number(e.target.value) }))}
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-gray-500 text-sm whitespace-nowrap">= {Math.round(settings.overtimePremiumRate * 100)}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">閾値（分）</label>
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      value={settings.overtimeDailyThresholdMinutes}
                      onChange={(e) => setSettings(s => ({ ...s, overtimeDailyThresholdMinutes: Number(e.target.value) }))}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="480"
                    />
                    <p className="mt-1 text-xs text-gray-500">480分 = 8時間</p>
                  </div>
                </div>
              </SettingCard>

              {/* 休日割増 */}
              <SettingCard
                icon="🎌"
                title="休日割増"
                description="休日勤務時の割増賃金を設定します"
                enabled={settings.holidayPremiumEnabled}
                onToggle={(v) => setSettings(s => ({ ...s, holidayPremiumEnabled: v }))}
                disabled={!canEdit}
                preview={settings.holidayPremiumEnabled && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-blue-700">休日時給</span>
                    <span className="font-bold text-blue-900">
                      ¥{previews.holidayWage.toLocaleString()}
                      <span className="text-xs font-normal text-blue-600 ml-1">(+¥{previews.holidayBonus.toLocaleString()})</span>
                    </span>
                  </div>
                )}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">割増率</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={2}
                        value={settings.holidayPremiumRate}
                        onChange={(e) => setSettings(s => ({ ...s, holidayPremiumRate: Number(e.target.value) }))}
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-gray-500 text-sm whitespace-nowrap">= {Math.round(settings.holidayPremiumRate * 100)}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">休日の定義</label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.holidayIncludesWeekend}
                        onChange={(e) => setSettings(s => ({ ...s, holidayIncludesWeekend: e.target.checked }))}
                        disabled={!canEdit}
                        className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">土日も休日扱いにする</span>
                    </label>
                    <p className="mt-1 text-xs text-gray-500">※ 祝日は自動で含まれます</p>
                  </div>
                </div>
              </SettingCard>

              {/* 交通費 */}
              <SettingCard
                icon="🚃"
                title="交通費"
                description="1シフトあたりの交通費を設定します"
                enabled={settings.transportAllowanceEnabled}
                onToggle={(v) => setSettings(s => ({ ...s, transportAllowanceEnabled: v }))}
                disabled={!canEdit}
              >
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">1シフトあたり</label>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500">¥</span>
                    <input
                      type="number"
                      min={0}
                      value={settings.transportAllowancePerShift}
                      onChange={(e) => setSettings(s => ({ ...s, transportAllowancePerShift: Number(e.target.value) }))}
                      disabled={!canEdit}
                      className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    💡 個別の交通費は
                    <button onClick={() => router.push('/company/members')} className="text-blue-600 hover:underline mx-1">メンバー管理</button>
                    から設定できます
                  </p>
                </div>
              </SettingCard>
            </>
          )}

          {/* シフトルールタブ */}
          {activeTab === 'shift' && (
            <SettingCard
              icon="📅"
              title="シフト提出ルール"
              description="スタッフがシフトを提出する締切を設定します"
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">提出サイクル</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'weekly', label: '毎週' },
                      { value: 'biweekly', label: '隔週' },
                      { value: 'monthly', label: '毎月' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setShiftSubmissionCycle(option.value as 'weekly' | 'biweekly' | 'monthly')}
                        disabled={!canEdit}
                        className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                          shiftSubmissionCycle === option.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {(shiftSubmissionCycle === 'weekly' || shiftSubmissionCycle === 'biweekly') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-blue-50 rounded-lg">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">週の開始日</label>
                      <select
                        value={weekStartDay}
                        onChange={(e) => setWeekStartDay(Number(e.target.value))}
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
                      <label className="block text-xs font-medium text-gray-600 mb-1">締切（週開始の何日前）</label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={weeklyDeadlineDaysBefore}
                        onChange={(e) => setWeeklyDeadlineDaysBefore(Number(e.target.value))}
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="mt-1 text-xs text-gray-600">
                        例: 3日前 → 週開始日の3日前までに提出
                      </p>
                    </div>
                  </div>
                )}

                {shiftSubmissionCycle === 'monthly' && (
                  <div className="p-4 bg-green-50 rounded-lg">
                    <label className="block text-xs font-medium text-gray-600 mb-1">締切日（毎月何日まで）</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={monthlyDeadlineDay}
                      onChange={(e) => setMonthlyDeadlineDay(Number(e.target.value))}
                      disabled={!canEdit}
                      className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                    <p className="mt-1 text-xs text-gray-600">
                      例: 25日 → 毎月25日までに翌月のシフトを提出
                    </p>
                  </div>
                )}
              </div>
            </SettingCard>
          )}

          {/* タイムカードタブ */}
          {activeTab === 'timecard' && (
            <SettingCard
              icon="⏰"
              title="タイムカード記録方法"
              description="誰がタイムカードを記録するかを設定します"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">管理者が記録</div>
                    <p className="text-sm text-gray-500 mt-0.5">管理者ダッシュボードからスタッフの勤怠を記録します</p>
                  </div>
                  <Toggle
                    enabled={isWatchAdmin}
                    onChange={(v) => {
                      setPendingWatchAdminValue(v);
                      setShowWatchAdminDialog(true);
                    }}
                    disabled={!canEdit}
                  />
                </div>
                
                <div className={`p-4 rounded-lg border-2 transition-all ${isWatchAdmin ? 'border-blue-200 bg-blue-50' : 'border-green-200 bg-green-50'}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{isWatchAdmin ? '👔' : '👤'}</span>
                    <div>
                      <div className="font-medium text-gray-900">
                        {isWatchAdmin ? '現在: 管理者モード' : '現在: スタッフモード'}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {isWatchAdmin 
                          ? '管理者が「タイムカード管理」画面からスタッフの出退勤を記録します。' 
                          : '各スタッフが自分のダッシュボードから出退勤を記録します。'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </SettingCard>
          )}
        </div>
      </main>

      {/* 固定フッター（保存ボタン） */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">
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
              disabled={!canEdit || saving || !hasChanges}
              className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
                canEdit && hasChanges
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  保存中...
                </span>
              ) : '設定を保存'}
            </button>
          </div>
        </div>
      </div>

      {/* タイムカード設定変更確認ダイアログ */}
      {showWatchAdminDialog && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{pendingWatchAdminValue ? '👔' : '👤'}</span>
                <h3 className="text-lg font-bold text-gray-900">記録方法の変更</h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                {pendingWatchAdminValue
                  ? '管理者ダッシュボードにタイムカードを表示します。管理者がスタッフのタイムカードを作成・編集できるようになります。'
                  : 'アルバイトダッシュボードにタイムカードを表示します。各アルバイトが個別に出退勤を記録します。'}
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                <p className="text-sm text-amber-800">
                  ⚠️ この設定を変更すると、タイムカードの記録方法が変わります。
                </p>
              </div>
            </div>
            <div className="flex border-t">
              <button
                onClick={() => setShowWatchAdminDialog(false)}
                className="flex-1 px-4 py-3 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  setIsWatchAdmin(pendingWatchAdminValue);
                  setShowWatchAdminDialog(false);
                }}
                className="flex-1 px-4 py-3 text-blue-600 font-medium hover:bg-blue-50 transition-colors border-l"
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