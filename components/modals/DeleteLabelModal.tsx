'use client';

import ConfirmModal from './ConfirmModal';

interface DeleteLabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  labelName: string;
}

export default function DeleteLabelModal({
  isOpen,
  onClose,
  onConfirm,
  labelName,
}: DeleteLabelModalProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="ラベルを削除"
      message={`「${labelName}」を削除します。この操作は取り消せません。`}
      confirmLabel="削除する"
      confirmButtonColor="red"
      icon={
        <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      }
    />
  );
}
