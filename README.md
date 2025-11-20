This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

# タイムカード管理システム

Next.js + Firebase で構築された、アルバイトスタッフ向けのシフト・勤怠・給与管理システムです。

## 主な機能

### 👥 ユーザー種別
- **企業管理者**: スタッフ管理、シフト承認、給与計算
- **アルバイトスタッフ**: シフト提出、タイムカード打刻、給与確認

### 🔑 企業管理者機能
- スタッフの追加・削除・権限管理 ([app/organization/members/page.tsx](app/organization/members/page.tsx))
- 組織加入申請の承認・却下 ([app/organization/requests/page.tsx](app/organization/requests/page.tsx))
- シフト申請の承認・却下 ([app/shifts/list/page.tsx](app/shifts/list/page.tsx))
- タイムカードの承認・給与計算 ([app/payroll/page.tsx](app/payroll/page.tsx))
- 月次レポート・CSV出力 ([app/report/page.tsx](app/report/page.tsx))
- 組織設定（時給・深夜手当・残業手当・交通費等） ([app/organization/settings/page.tsx](app/organization/settings/page.tsx))

### 👤 アルバイトスタッフ機能
- 組織への加入申請 ([app/join-organization/page.tsx](app/join-organization/page.tsx), [app/add-organization/page.tsx](app/add-organization/page.tsx))
- シフト提出（月/週/日ビュー対応） ([app/shifts/submit/page.tsx](app/shifts/submit/page.tsx))
- タイムカード打刻（出勤/休憩/退勤） ([app/dashboard/part-time/timecard/page.tsx](app/dashboard/part-time/timecard/page.tsx))
- 承認済みシフト確認 ([app/shifts/my/page.tsx](app/shifts/my/page.tsx))
- 給与明細確認 ([app/dashboard/part-time/payroll/page.tsx](app/dashboard/part-time/payroll/page.tsx))

### 💰 給与計算機能
- 基本給 = 時給 × 労働時間
- 深夜手当（22:00-5:00、25%増）
- 残業手当（8時間超過分、25%増）
- 休日手当（土日祝、35%増）
- 交通費（シフトあたり固定額）

## 技術スタック

- **フレームワーク**: Next.js 16.0.3 (App Router with Turbopack)
- **言語**: TypeScript
- **認証**: Firebase Authentication
- **データベース**: Cloud Firestore
- **スタイリング**: Tailwind CSS
- **日本の祝日**: japanese-holidays パッケージ

## プロジェクト構成

```
timecard-management-app/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   └── admin/                # 管理者専用API
│   │       ├── create-user/      # ユーザー作成
│   │       └── delete-user/      # ユーザー削除
│   ├── dashboard/
│   │   ├── company/              # 企業ダッシュボード
│   │   └── part-time/            # アルバイトダッシュボード
│   │       ├── timecard/         # タイムカード打刻
│   │       └── payroll/          # 給与明細
│   ├── shifts/                   # シフト関連
│   │   ├── submit/               # シフト提出
│   │   ├── list/                 # シフト一覧（管理者）
│   │   ├── my/                   # 自分のシフト
│   │   └── schedule/             # 承認済みシフト
│   ├── organization/             # 組織管理
│   │   ├── members/              # メンバー管理
│   │   ├── staff/                # スタッフ一覧
│   │   ├── settings/             # 組織設定
│   │   └── requests/             # 加入申請一覧
│   ├── add-organization/         # 組織追加申請
│   ├── join-organization/        # 組織加入申請
│   ├── payroll/                  # 給与管理
│   ├── report/                   # レポート
│   ├── timecards/                # タイムカード一覧
│   ├── profile/                  # プロフィール
│   ├── profile-setup/            # 初回プロフィール設定
│   ├── login/                    # ログイン
│   │   ├── company/              # 企業ログイン
│   │   └── part-time/            # アルバイトログイン
│   └── signup/                   # 新規登録
│       ├── company/              # 企業登録
│       └── part-time/            # アルバイト登録
├── components/                   # 共通コンポーネント
│   └── OrganizationSelector.tsx  # 組織選択
├── contexts/                     # React Context
│   └── AuthContext.tsx           # 認証コンテキスト
├── lib/
│   ├── firebase.ts               # Firebase初期化
│   └── firebase-admin.ts         # Firebase Admin SDK
├── types/                        # TypeScript型定義
│   └── index.ts                  # 共通型定義
├── scripts/                      # ユーティリティスクリプト
│   ├── migrate-timecards.ts      # タイムカード移行
│   └── sync-hourly-wage.cjs      # 時給同期
├── firestore.rules               # Firestoreセキュリティルール
└── firestore.indexes.json        # Firestoreインデックス
```

## セットアップ

### 1. リポジトリのクローン
```bash
git clone https://github.com/hinataNotsu/timecard-management-app.git
cd timecard-management-app
```

### 2. 依存関係のインストール
```bash
npm install
```

### 3. Firebase プロジェクトの設定
1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成
2. Authentication で「メール/パスワード」を有効化
3. Firestore Database を作成
4. Firebase SDK 設定を取得し、[lib/firebase.ts](lib/firebase.ts) に設定

```typescript
// lib/firebase.ts
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 4. Firestore セキュリティルールの設定
[firestore.rules](firestore.rules) の内容を Firebase Console にデプロイ:
```bash
firebase deploy --only firestore:rules
```

### 5. Firestore インデックスの作成
[firestore.indexes.json](firestore.indexes.json) のインデックスを作成:
```bash
firebase deploy --only firestore:indexes
```

### 6. 環境変数の設定（Admin SDK用）
`.env.local` を作成:
```env
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 7. 開発サーバーの起動
```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) でアプリケーションが起動します。

## 主要なデータモデル

### User ([types/index.ts](types/index.ts))
```typescript
interface User {
  uid: string;
  email: string;
  organizationIds: string[];      // 所属組織ID配列
  currentOrganizationId?: string; // 現在選択中の組織
  isManage: boolean;              // 管理者権限
  displayName?: string;           // 表示名
  phoneNumber?: string;           // 電話番号
  birthDate?: string;             // 生年月日
  address?: string;               // 住所
  deleted?: boolean;              // 論理削除フラグ
  profileCompleted?: boolean;     // プロフィール登録完了
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### Organization ([types/index.ts](types/index.ts))
```typescript
interface Organization {
  id: string;
  name: string;                   // 企業名
  createdBy: string;              // 作成者UID
  defaultHourlyWage?: number;     // デフォルト時給
  nightPremiumEnabled?: boolean;  // 深夜手当有効化
  nightPremiumRate?: number;      // 深夜手当率（0.25 = 25%）
  nightStart?: string;            // 深夜開始時刻 "22:00"
  nightEnd?: string;              // 深夜終了時刻 "05:00"
  overtimePremiumEnabled?: boolean;
  overtimePremiumRate?: number;
  overtimeDailyThresholdMinutes?: number;
  holidayPremiumEnabled?: boolean;
  holidayPremiumRate?: number;
  transportAllowanceEnabled?: boolean;
  transportAllowancePerShift?: number;
  permissionList?: Array<{        // 加入申請リスト
    uid: string;
    displayName: string;
    email: string;
    createdAt: Timestamp;
  }>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### Shift ([types/index.ts](types/index.ts))
```typescript
interface Shift {
  id: string;
  organizationId: string;
  userId: string;                 // アルバイトのUID
  userName: string;               // アルバイトの名前
  date: Timestamp;                // シフト日
  startTime: string;              // "09:00"
  endTime: string;                // "18:00"
  breakTime: number;              // 休憩時間（分）
  hourlyWage: number;             // 時給
  status: 'pending' | 'approved' | 'rejected';
  estimatedPay: number;           // 見込み給与
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### Timecard ([types/index.ts](types/index.ts))
```typescript
interface Timecard {
  id: string;
  organizationId: string;
  userId: string;                 // アルバイトのUID
  userName: string;               // アルバイトの名前
  date: Timestamp;                // 勤務日
  clockIn: Timestamp;             // 出勤時刻
  clockOut?: Timestamp;           // 退勤時刻
  breakTime: number;              // 休憩時間（分）
  hourlyWage: number;             // 時給
  totalHours?: number;            // 総労働時間
  totalPay?: number;              // 給与
  status: 'in_progress' | 'completed';
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## 主要な画面フロー

### 企業管理者
1. [企業登録](app/signup/company/page.tsx) → [企業ログイン](app/login/company/page.tsx)
2. [ダッシュボード](app/dashboard/company/page.tsx) でスタッフ数・統計確認、企業IDコピー
3. [加入申請管理](app/organization/requests/page.tsx) でスタッフの加入申請を承認/削除
4. [メンバー管理](app/organization/members/page.tsx) でスタッフ追加・時給設定
5. [シフト一覧](app/shifts/list/page.tsx) でシフト承認
6. [給与管理](app/payroll/page.tsx) でタイムカード承認
7. [レポート](app/report/page.tsx) で月次集計・CSV出力

### アルバイトスタッフ
1. [アルバイト登録](app/signup/part-time/page.tsx) → [ログイン](app/login/part-time/page.tsx)
2. [プロフィール設定](app/profile-setup/page.tsx) で基本情報入力
3. [企業ID入力](app/join-organization/page.tsx) で組織に加入申請（管理者の承認待ち）
4. 承認後、[ダッシュボード](app/dashboard/part-time/page.tsx) で今月の見込み給与確認
5. [シフト提出](app/shifts/submit/page.tsx) でシフト登録
6. [タイムカード](app/dashboard/part-time/timecard/page.tsx) で出退勤打刻
7. [給与明細](app/dashboard/part-time/payroll/page.tsx) で確定給与確認

## 組織加入申請フロー

このシステムでは、アルバイトスタッフが組織に加入する際に承認制を採用しています：

1. **申請**: アルバイトが企業IDを入力して申請
   - データは `organizations/{id}/permissionList[]` に保存
   - `{uid, displayName, email, createdAt}` を含む

2. **承認**: 企業管理者が申請を確認
   - [申請一覧画面](app/organization/requests/page.tsx) で確認
   - 承認 → `users/{uid}/organizationIds[]` に組織IDを追加
   - 削除 → `permissionList` から削除

3. **アクセス許可**: 承認後、アルバイトはダッシュボードや各機能にアクセス可能

## Firestore セキュリティルール

[firestore.rules](firestore.rules) では以下のセキュリティ制御を実装：

- **ユーザー読み取り**: 自分自身 or 同じ組織のメンバー
- **ユーザー更新**: 自分自身 or 管理者による組織メンバー追加/削除
- **組織の permissionList**: 認証済みユーザーは読み書き可能
- **シフト/タイムカード**: 所属組織内のデータのみアクセス可能
- **管理者権限**: `isManage: true` のユーザーは組織内データを管理可能

## ユーティリティスクリプト

### タイムカードの時給同期
組織・メンバー設定に基づいて時給を一括更新:
```bash
node scripts/sync-hourly-wage.cjs --org <ORG_ID> --month 2025-01 --mode all --yes
```

## デプロイ

### Vercel へのデプロイ
1. [Vercel](https://vercel.com/) にリポジトリを接続
2. 環境変数を設定（Admin SDK用）
3. デプロイ実行

### Firebase Hosting へのデプロイ
```bash
npm run build
firebase deploy
```

## ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。

## 開発者向けメモ

- シフト・タイムカードは [`organizationId` + `userRef` + `date`](firestore.indexes.json) のインデックスが必要
- 削除済みユーザーは [`deleted: true`](types/index.ts) フラグで論理削除
- 深夜時間帯は [`calcNightMinutes`](app/report/page.tsx) で計算
- CSV出力は UTF-8 BOM 付き（Excel対応）
- 組織加入は承認制（`permissionList[]` → 承認 → `organizationIds[]`）
- ダイアログの背景透過は `bg-black/30` を使用（30%透過）

