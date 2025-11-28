'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useCompanyPayroll } from './hooks/useCompanyPayroll';
import { PayrollHeader, ApplicationList } from './components';

export default function PayrollPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const {
    loading,
    error,
    applications,
    monthlyReports,
    orgSettings,
    memberTransport,
    handleApprove,
    handleSaveEdit,
  } = useCompanyPayroll(selectedMonth);

  // 管理者でなければリダイレクト
  useEffect(() => {
    if (!userProfile) return;
    if (!userProfile.isManage) {
      router.push('/staff/dashboard');
      return;
    }
  }, [userProfile, router]);

  const prevMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1));
  };

  const handleBack = () => {
    router.push('/company/dashboard');
  };

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

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <PayrollHeader
          selectedMonth={selectedMonth}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          onBack={handleBack}
        />

        <ApplicationList
          applications={applications}
          monthlyReports={monthlyReports}
          orgSettings={orgSettings}
          memberTransport={memberTransport}
          onApprove={handleApprove}
          onSaveEdit={handleSaveEdit}
        />
      </div>
    </div>
  );
}
