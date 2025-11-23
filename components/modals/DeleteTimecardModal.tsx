'use client';

import ConfirmModal from './ConfirmModal';

interface DeleteTimecardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  userName: string;
}

export default function DeleteTimecardModal({
  isOpen,
  onClose,
  onConfirm,
  userName,
}: DeleteTimecardModalProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="タイムカードを削除"
      message={`${userName}のタイムカードを削除します。この操作は取り消せません。`}
      confirmLabel="削除する"
      confirmButtonColor="red"
      icon={
        <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      }
    />
  );
}
