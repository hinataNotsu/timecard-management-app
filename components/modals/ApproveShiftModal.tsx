'use client';

import ConfirmModal from './ConfirmModal';

interface ApproveShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message?: string;
}

export default function ApproveShiftModal({
  isOpen,
  onClose,
  onConfirm,
  message,
}: ApproveShiftModalProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="シフトを承認"
      message={message || 'このシフトを承認します。'}
      confirmLabel="承認する"
      confirmButtonColor="green"
      icon={
        <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      }
    />
  );
}
