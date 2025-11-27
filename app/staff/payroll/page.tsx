'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePayrollData } from './hooks/usePayrollData';
import { exportPayrollCsv } from './utils/payrollCalculations';
import {
  PayrollHeader,
  MonthlyReportStatus,
  PayrollSummary,
  PayrollChart,
  TimecardList,
} from './components';

export default function PartTimePayrollPage() {
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const {
    loading,
    error,
    timecards,
    orgSettings,
    transportPerShift,
    monthlyReport,
    summary,
    groupedTimecards,
    chartData,
    completedDraftCards,
    canSubmit,
    handleBulkSubmit,
    setLoading,
    setError,
  } = usePayrollData(selectedMonth);

  const prevMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));
  };

  const handleExportCsv = () => {
    exportPayrollCsv(timecards, orgSettings, transportPerShift, selectedMonth);
  };

  const handleBack = () => {
    router.push('/staff/dashboard');
  };

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1));
  };

  // ローディング画面
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  // エラー画面
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <PayrollHeader
          selectedMonth={selectedMonth}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          onExportCsv={handleExportCsv}
          onBulkSubmit={handleBulkSubmit}
          canSubmit={canSubmit}
          draftCount={completedDraftCards.length}
          onBack={handleBack}
        />

        <MonthlyReportStatus monthlyReport={monthlyReport} />

        <PayrollSummary summary={summary} />

        <PayrollChart chartData={chartData} />

        <TimecardList
          groupedTimecards={groupedTimecards}
          orgSettings={orgSettings}
          transportPerShift={transportPerShift}
        />
      </div>
    </div>
  );
}