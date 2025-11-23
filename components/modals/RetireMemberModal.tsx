'use client';

import ConfirmModal from './ConfirmModal';

interface RetireMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  memberName: string;
}

export default function RetireMemberModal({
  isOpen,
  onClose,
  onConfirm,
  memberName,
}: RetireMemberModalProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="メンバーを退職処理"
      message={
        <>
          <p className="font-semibold text-gray-900 mb-2">{memberName}</p>
          <p className="text-left space-y-1">
            <span className="block">• この組織でのアクセスができなくなります</span>
            <span className="block">• 他の組織には影響しません</span>
            <span className="block">• 過去のシフトやタイムカードは記録として残ります</span>
          </p>
        </>
      }
      confirmLabel="退職処理する"
      confirmButtonColor="amber"
      icon={
        <svg className="h-6 w-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      }
    />
  );
}
