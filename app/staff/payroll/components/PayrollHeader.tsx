interface PayrollHeaderProps {
  selectedMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onExportCsv: () => void;
  onBulkSubmit: () => void;
  canSubmit: boolean;
  draftCount: number;
  onBack: () => void;
}

export const PayrollHeader = ({
  selectedMonth,
  onPrevMonth,
  onNextMonth,
  onExportCsv,
  onBulkSubmit,
  canSubmit,
  draftCount,
  onBack,
}: PayrollHeaderProps) => {
  return (
    <>
      {/* タイトルヘッダー */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">給与明細</h1>
        <button
          onClick={onBack}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          ← ダッシュボード
        </button>
      </div>

      {/* 月選択 + ボタン */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={onPrevMonth} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">←</button>
            <span className="font-semibold text-lg">
              {selectedMonth.getFullYear()}年{selectedMonth.getMonth() + 1}月
            </span>
            <button onClick={onNextMonth} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">→</button>
          </div>
          <div className="flex items-center gap-2">
            {canSubmit && (
              <button
                onClick={onBulkSubmit}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
              >
                下書き{draftCount}件を申請
              </button>
            )}
            <button
              onClick={onExportCsv}
              className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700"
            >
              CSV出力
            </button>
          </div>
        </div>
      </div>
    </>
  );
};