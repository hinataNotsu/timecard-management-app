import { Timestamp } from 'firebase/firestore';

// ユーザー情報
export interface User {
  uid: string;
  email: string;
  organizationIds: string[]; // 所属組織IDの配列
  currentOrganizationId?: string; // 現在選択中の組織ID
  isManage: boolean; // 管理者権限(企業ログイン可否)
  displayName?: string;
  phoneNumber?: string; // 電話番号
  birthDate?: string; // 生年月日
  address?: string; // 住所
  deleted?: boolean; // 削除済みフラグ
  deletedAt?: Timestamp; // 削除日時
  requirePasswordChange?: boolean; // パスワード変更が必要
  profileCompleted?: boolean; // 初回プロフィール登録が完了しているか
  avatarSeed?: string; // アバターシード
  avatarBackgroundColor?: string; // アバター背景色
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// 組織情報
export interface Organization {
  id: string; // ドキュメントID
  name: string; // 企業名
  createdBy: string; // 作成者のUID
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // 給与設定
  defaultHourlyWage?: number; // デフォルト時給（円）
  nightPremiumEnabled?: boolean; // 深夜割増を適用するか
  nightPremiumRate?: number; // 深夜割増率（例: 0.25 = 25%）
  nightStart?: string; // 深夜開始時刻 (HH:mm)
  nightEnd?: string; // 深夜終了時刻 (HH:mm)
  // 残業割増
  overtimePremiumEnabled?: boolean; // 残業割増を適用するか
  overtimePremiumRate?: number; // 残業割増率（例: 0.25 = 25%）
  overtimeDailyThresholdMinutes?: number; // 1日あたり閾値（分）例: 480 = 8時間
  // 休日割増
  holidayPremiumEnabled?: boolean; // 休日割増を適用するか
  holidayPremiumRate?: number; // 休日割増率（例: 0.35 = 35%）
  holidayIncludesWeekend?: boolean; // 休日に土日を含める
  // 交通費
  transportAllowanceEnabled?: boolean; // 交通費を支給するか
  transportAllowancePerShift?: number; // 1シフトあたり交通費（円）
  // タイムカード表示設定
  isWatchAdmin?: boolean; // 管理者ダッシュボードにタイムカードを表示するか（true: 管理者, false: アルバイト）デフォルトtrue
  // シフト提出ルール
  shiftSubmissionCycle?: 'weekly' | 'biweekly' | 'monthly'; // シフト提出サイクル
  weekStartDay?: number; // 週の開始日 (0=日曜, 1=月曜, ..., 6=土曜)
  weeklyDeadlineDaysBefore?: number; // 週の開始日の何日前が締切か
  monthlyDeadlineDay?: number; // 月次締切日 (1-31)
}

// シフト情報
export interface Shift {
  id: string;
  organizationId: string;
  userId: string; // アルバイトのUID
  userName: string; // アルバイトの名前
  date: Timestamp; // シフト日
  startTime: string; // 開始時刻 (HH:mm形式)
  endTime: string; // 終了時刻 (HH:mm形式)
  breakTime: number; // 休憩時間（分）
  hourlyWage: number; // 時給
  status: 'pending' | 'approved' | 'rejected'; // ステータス
  estimatedPay: number; // 見込み給与
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// タイムカード情報
export interface Timecard {
  id: string;
  organizationId: string;
  userId: string; // アルバイトのUID
  userName: string; // アルバイトの名前
  date: Timestamp; // 勤務日
  clockIn: Timestamp; // 出勤時刻
  clockOut?: Timestamp; // 退勤時刻
  breakTime: number; // 休憩時間（分）
  hourlyWage: number; // 時給
  totalHours?: number; // 総労働時間
  totalPay?: number; // 給与
  status: 'in_progress' | 'completed'; // ステータス
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// シフト提出用のフォームデータ
export interface ShiftFormData {
  date: string;
  startTime: string;
  endTime: string;
  breakTime: number;
  hourlyWage: number;
}
