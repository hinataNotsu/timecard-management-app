# モーダルコンポーネント実装ガイド

## 実装済みのモーダルコンポーネント

`components/modals/` に以下のモーダルを作成しました：

1. **ConfirmModal.tsx** - 汎用確認モーダル（ベースコンポーネント）
2. **RetireMemberModal.tsx** - メンバー退職処理
3. **DeleteTimecardModal.tsx** - タイムカード削除
4. **DeleteShiftModal.tsx** - シフト削除
5. **SubmitTimecardsModal.tsx** - タイムカード一括申請
6. **ApproveShiftModal.tsx** - シフト承認
7. **DeleteLabelModal.tsx** - ラベル削除
8. **ApproveTimecardModal.tsx** - タイムカード承認

## 各ページでの適用方法

### 基本パターン

```tsx
// 1. モーダルをインポート
import { DeleteTimecardModal } from '@/components/modals';

// 2. モーダルの状態を管理
const [deleteModal, setDeleteModal] = useState<{ 
  isOpen: boolean; 
  id: string; 
  userName: string 
}>({ isOpen: false, id: '', userName: '' });

// 3. confirm を削除し、関数をそのまま実行可能に
const deleteTimecard = async (id: string, userName: string) => {
  // if (!confirm(...)) return; を削除
  setDeleting(id);
  try {
    // 削除処理
  } catch (error) {
    // エラーハンドリング
  } finally {
    setDeleting(null);
  }
};

// 4. ボタンのonClickをモーダルオープンに変更
<button onClick={() => setDeleteModal({ isOpen: true, id: tc.id, userName: tc.userName })}>
  削除
</button>

// 5. JSXの最後にモーダルコンポーネントを追加
<DeleteTimecardModal
  isOpen={deleteModal.isOpen}
  onClose={() => setDeleteModal({ isOpen: false, id: '', userName: '' })}
  onConfirm={() => deleteTimecard(deleteModal.id, deleteModal.userName)}
  userName={deleteModal.userName}
/>
```

## 各ファイルの修正箇所

### ✅ 完了: `app/company/members/page.tsx`
- RetireMemberModal を使用
- `markAsRetired` 関数から confirm を削除

### ✅ 完了: `app/company/payroll/page.tsx`
- ApproveTimecardModal を使用
- `handleApprove` 関数から confirm を削除

### 🔄 進行中: 以下のファイルで同様の修正が必要

#### `app/company/timecards/page.tsx`
- DeleteTimecardModal を使用
- Line 193: `if (!confirm(...))` を削除

#### `app/company/timecard-management/page.tsx`
- DeleteTimecardModal を使用
- Line 195: `if (!confirm(...))` を削除

#### `app/staff/shifts/request/page.tsx`
- DeleteShiftModal を使用
- Line 718: `if (!confirm('このシフトを削除しますか？'))` を削除

#### `app/staff/payroll/page.tsx`
- SubmitTimecardsModal を使用
- Line 284 & 288: 2つの confirm を削除
  - 未完了リスト付きの確認
  - 通常の一括申請確認

#### `app/company/shifts/page.tsx`
- ApproveShiftModal を使用
- DeleteLabelModal を使用
- Line 331: シフト承認の confirm
- Line 1234: ラベル削除の confirm

## デザイン仕様

### カラーパレット
- **承認系**: `green` (#10B981)
- **削除系**: `red` (#EF4444)
- **警告系**: `amber` (#F59E0B)
- **通常**: `blue` (#3B82F6)

### アイコン
- 承認: チェックマーク円形 (`M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z`)
- 削除: ゴミ箱 (`M19 7l-.867 12.142...`)
- 警告: 三角形エクスクラメーション

### アニメーション
- `animate-fadeIn` クラスを使用（globals.cssに定義済み）
- フェードイン + スケールアップ効果（0.2s）

## 次のステップ

各ページで以下の手順を実行してください：

1. モーダルをインポート
2. useState でモーダルの状態を管理
3. confirm 呼び出しを削除
4. ボタンのonClickをモーダルオープンに変更
5. JSXの最後にモーダルを配置

## 注意事項

- **confirm** は完全に削除せず、ページ遷移時の未保存警告にのみ使用
- モーダルの `onConfirm` は自動的に `onClose` を呼ぶため、手動で閉じる必要なし
- 複数のモーダルを使用する場合は、それぞれ別の state で管理

## カスタムモーダルの作成

新しいモーダルが必要な場合は、`ConfirmModal` をベースに作成：

\`\`\`tsx
import ConfirmModal from './ConfirmModal';

export default function CustomModal({ isOpen, onClose, onConfirm, ... }) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="タイトル"
      message="メッセージ"
      confirmLabel="実行する"
      confirmButtonColor="blue"
      icon={<svg>...</svg>}
    />
  );
}
\`\`\`
