import { statusStyles, statusLabels } from '@/lib/payroll';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyles[status] || 'bg-gray-100'}`}>
      {statusLabels[status] || status}
    </span>
  );
};