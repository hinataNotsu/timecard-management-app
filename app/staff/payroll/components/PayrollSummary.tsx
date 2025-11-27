import { PayrollSummary as PayrollSummaryType } from '../types';

interface PayrollSummaryProps {
  summary: PayrollSummaryType;
}

export const PayrollSummary = ({ summary }: PayrollSummaryProps) => {
  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <div className="text-gray-500 text-xs sm:text-sm">出勤日数</div>
          <div className="text-xl sm:text-2xl font-bold">{summary.days}日</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500 text-xs sm:text-sm">総勤務時間</div>
          <div className="text-xl sm:text-2xl font-bold">{Math.floor(summary.totalMin / 60)}h{summary.totalMin % 60}m</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500 text-xs sm:text-sm">深夜時間</div>
          <div className="text-xl sm:text-2xl font-bold">{Math.floor(summary.nightMin / 60)}h{summary.nightMin % 60}m</div>
        </div>
        <div className="text-center">
          <div className="text-gray-500 text-xs sm:text-sm">残業時間</div>
          <div className="text-xl sm:text-2xl font-bold">{Math.floor(summary.overtimeMin / 60)}h{summary.overtimeMin % 60}m</div>
        </div>
      </div>
      <div className="border-t pt-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          <div><span className="text-gray-500">基本給:</span> ¥{Math.round(summary.base).toLocaleString()}</div>
          <div><span className="text-gray-500">深夜:</span> ¥{Math.round(summary.night).toLocaleString()}</div>
          <div><span className="text-gray-500">残業:</span> ¥{Math.round(summary.overtime).toLocaleString()}</div>
          <div><span className="text-gray-500">休日:</span> ¥{Math.round(summary.holiday).toLocaleString()}</div>
          <div><span className="text-gray-500">交通費:</span> ¥{Math.round(summary.transport).toLocaleString()}</div>
          <div className="font-bold text-blue-600 text-base sm:text-lg">合計: ¥{summary.total.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
};