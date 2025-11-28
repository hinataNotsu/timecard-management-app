'use client';

import { UserApplication, OrgSettings } from '@/lib/payroll';
import { ApplicationCard } from './ApplicationCard';

interface ApplicationListProps {
  applications: UserApplication[];
  monthlyReports: Record<string, any>;
  orgSettings: OrgSettings | null;
  memberTransport: Record<string, number>;
  onApprove: (userId: string) => void;
  onSaveEdit: (id: string, clockInAt: string, clockOutAt: string) => Promise<void>;
}

export const ApplicationList = ({
  applications,
  monthlyReports,
  orgSettings,
  memberTransport,
  onApprove,
  onSaveEdit,
}: ApplicationListProps) => {
  if (applications.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        承認待ちの申請はありません
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {applications.map((app) => {
        const report = monthlyReports[app.userId];
        const isAdditional = report?.status === 'confirmed';

        return (
          <ApplicationCard
            key={app.userId}
            app={app}
            isAdditional={isAdditional}
            orgSettings={orgSettings}
            memberTransport={memberTransport}
            onApprove={onApprove}
            onSaveEdit={onSaveEdit}
          />
        );
      })}
    </div>
  );
};
