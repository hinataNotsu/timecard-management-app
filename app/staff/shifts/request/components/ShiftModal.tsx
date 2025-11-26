'use client';

import { useState, useEffect, memo } from 'react';
import type { ShiftEntry } from '../utils/types';

interface ShiftModalProps {
  isOpen: boolean;
  editingId: string | null;
  initialShift: ShiftEntry;
  onSave: (shift: ShiftEntry) => Promise<boolean>;
  onUpdate: (id: string, shift: ShiftEntry) => Promise<boolean>;
  onDelete: (id: string) => void;
  onClose: () => void;
  canSubmitForDate: (date: Date) => boolean;
}

export const ShiftModal = memo(function ShiftModal({
  isOpen,
  editingId,
  initialShift,
  onSave,
  onUpdate,
  onDelete,
  onClose,
  canSubmitForDate,
}: ShiftModalProps) {
  const [shift, setShift] = useState<ShiftEntry>(initialShift);

  useEffect(() => {
    setShift(initialShift);
  }, [initialShift]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!shift.date || !shift.startTime || !shift.endTime) return;

    if (shift.startTime >= shift.endTime) {
      alert('終了時刻は開始時刻より後にしてください');
      return;
    }

    // 30分未満チェック
    const [startH, startM] = shift.startTime.split(':').map(v => parseInt(v, 10));
    const [endH, endM] = shift.endTime.split(':').map(v => parseInt(v, 10));
    const durationMin = (endH * 60 + endM) - (startH * 60 + startM);
    if (durationMin < 30) {
      alert('シフトは30分以上で登録してください');
      return;
    }

    if (!canSubmitForDate(new Date(shift.date))) {
      alert('この日のシフトは締切を過ぎているため変更できません');
      return;
    }

    let success: boolean;
    if (editingId) {
      success = await onUpdate(editingId, shift);
    } else {
      success = await onSave(shift);
    }

    if (success) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">
          {editingId ? 'シフト編集' : 'シフト追加'}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">日付</label>
            <input
              type="date"
              value={shift.date}
              onChange={(e) => setShift({ ...shift, date: e.target.value })}
              className="w-full border rounded-md px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">開始時刻</label>
              <input
                type="time"
                value={shift.startTime}
                onChange={(e) => setShift({ ...shift, startTime: e.target.value })}
                className="w-full border rounded-md px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">終了時刻</label>
              <input
                type="time"
                value={shift.endTime}
                onChange={(e) => setShift({ ...shift, endTime: e.target.value })}
                className="w-full border rounded-md px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <textarea
              value={shift.note || ''}
              onChange={(e) => setShift({ ...shift, note: e.target.value })}
              className="w-full border rounded-md px-3 py-2"
              rows={3}
            />
          </div>
        </div>

        <div className="flex justify-between mt-6">
          <div>
            {editingId && (
              <button
                onClick={() => onDelete(editingId)}
                className="px-4 py-2 text-red-600 hover:text-red-800"
              >
                削除
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
            >
              {editingId ? '更新' : '追加'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});