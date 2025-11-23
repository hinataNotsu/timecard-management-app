'use client';

import ConfirmModal from './ConfirmModal';

interface SubmitTimecardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  count: number;
  incompleteList?: string[];
}

export default function SubmitTimecardsModal({
  isOpen,
  onClose,
  onConfirm,
  count,
  incompleteList,
}: SubmitTimecardsModalProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="タイムカードを一括申請"
      message={
        incompleteList && incompleteList.length > 0 ? (
          <>
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-3 text-left">
              <p className="font-semibold text-yellow-800 mb-1">未完了のタイムカード:</p>
              <div className="text-xs text-yellow-700 max-h-32 overflow-y-auto">
                {incompleteList.map((item, i) => (
                  <div key={i}>{item}</div>
                ))}
              </div>
            </div>
            <p>完了済みの{count}件のタイムカードを申請します。</p>
          </>
        ) : (
          <p>{count}件のタイムカードを一括申請します。</p>
        )
      }
      confirmLabel="申請する"
      confirmButtonColor="blue"
      icon={
        <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      }
    />
  );
}
