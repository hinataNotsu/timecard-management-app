import { MonthlyReport } from '../types';

interface MonthlyReportStatusProps {
  monthlyReport: MonthlyReport | null;
}

export const MonthlyReportStatus = ({ monthlyReport }: MonthlyReportStatusProps) => {
  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600">月次レポート:</span>
        {monthlyReport?.status === 'approved' ? (
          <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 rounded text-sm">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            確定済み
          </span>
        ) : (
          <span className="flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 rounded text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            未確定
          </span>
        )}
      </div>
    </div>
  );
};