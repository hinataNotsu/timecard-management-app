'use client';

import ConfirmModal from './ConfirmModal';

interface ApproveTimecardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ApproveTimecardModal({
  isOpen,
  onClose,
  onConfirm,
}: ApproveTimecardModalProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="タイムカードを承認"
      message="この申請を承認します。承認後は月次レポートに反映されます。"
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
