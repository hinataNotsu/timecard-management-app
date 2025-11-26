// ステータスに応じたクラス
export const classesForStatus = (status: string | undefined, kind: 'month' | 'block') => {
  const st = status ?? 'pending';
  if (kind === 'month') {
    if (st === 'approved') return 'bg-green-100 text-green-800 hover:bg-green-200';
    if (st === 'rejected') return 'bg-red-100 text-red-800 hover:bg-red-200';
    return 'bg-blue-100 text-blue-800 hover:bg-blue-200';
  } else {
    if (st === 'approved') return 'bg-green-500 text-white';
    if (st === 'rejected') return 'bg-red-500 text-white';
    return 'bg-blue-500 text-white';
  }
};

// ステータスラベル
export const getStatusLabel = (status: string | undefined): string => {
  const st = status ?? 'pending';
  if (st === 'approved') return '承認済';
  if (st === 'rejected') return '却下';
  return '未承認';
};