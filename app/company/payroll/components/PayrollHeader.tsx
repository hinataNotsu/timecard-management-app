'use client';

interface PayrollHeaderProps {
  selectedMonth: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onBack: () => void;
}

export const PayrollHeader = ({
  selectedMonth,
  onPrevMonth,
  onNextMonth,
  onBack,
}: PayrollHeaderProps) => {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">給与管理</h1>
        <div className="flex items-center gap-2">
          <button 
            onClick={onPrevMonth} 
            className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
          >
            ←
          </button>
          <span className="font-semibold">
            {selectedMonth.getFullYear()}年{selectedMonth.getMonth() + 1}月
          </span>
          <button 
            onClick={onNextMonth} 
            className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
          >
            →
          </button>
        </div>
      </div>
      <button
        onClick={onBack}
        className="text-sm text-gray-600 hover:text-gray-900"
      >
        ← ダッシュボード
      </button>
    </div>
  );
};
