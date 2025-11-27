interface StatusBadgeProps {
  status: string;
}

const styles: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const labels: Record<string, string> = {
  draft: '下書き',
  pending: '申請中',
  approved: '承認済',
  rejected: '却下',
};

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
      {labels[status] || status}
    </span>
  );
};