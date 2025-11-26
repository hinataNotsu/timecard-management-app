'use client';

import { useState, useEffect, useRef, memo } from 'react';
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
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  
  // ドラッグ用state
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShift(initialShift);
  }, [initialShift]);

  // 背景スクロール無効化
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflow = 'hidden';
      
      return () => {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  // 開くアニメーション
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    }
  }, [isOpen]);

  // 閉じる処理（アニメーション付き）
  const handleClose = () => {
    setIsVisible(false);
    setDragY(0);
    setTimeout(() => {
      setIsAnimating(false);
      onClose();
    }, 300);
  };

  // ドラッグ開始
  const handleTouchStart = (e: React.TouchEvent) => {
    // 入力欄内でのタッチは無視
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') {
      return;
    }
    
    dragStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  // ドラッグ中
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    
    const currentY = e.touches[0].clientY;
    const diff = currentY - dragStartY.current;
    
    // 下方向のみ許可
    if (diff > 0) {
      setDragY(diff);
    }
  };

  // ドラッグ終了
  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    
    // 100px以上ドラッグしたら閉じる
    if (dragY > 100) {
      handleClose();
    } else {
      // 元に戻す
      setDragY(0);
    }
  };

  if (!isOpen && !isAnimating) return null;

  const handleSubmit = async () => {
    if (!shift.date || !shift.startTime || !shift.endTime) return;

    if (shift.startTime >= shift.endTime) {
      alert('終了時刻は開始時刻より後にしてください');
      return;
    }

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
      handleClose();
    }
  };

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center transition-colors duration-300 ${isVisible ? 'bg-black/30' : 'bg-transparent'}`}
      onClick={handleClose}
    >
      <div 
        ref={sheetRef}
        className={`bg-white rounded-t-xl sm:rounded-lg p-4 sm:p-6 w-full sm:max-w-md max-h-[90vh] overflow-y-auto ${isDragging ? '' : 'transition-transform duration-300 ease-out'} ${isVisible && dragY === 0 ? 'translate-y-0 sm:scale-100 sm:opacity-100' : !isVisible ? 'translate-y-full sm:translate-y-0 sm:scale-95 sm:opacity-0' : ''}`}
        style={{ 
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* ドラッグハンドル（スマホ用） */}
        <div className="sm:hidden flex justify-center mb-2 py-2 cursor-grab">
          <div className="w-10 h-1 bg-gray-300 rounded-full"></div>
        </div>

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
              className="w-full border rounded-md px-3 py-3 sm:py-2 text-base"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">開始時刻</label>
              <input
                type="time"
                value={shift.startTime}
                onChange={(e) => setShift({ ...shift, startTime: e.target.value })}
                className="w-full border rounded-md px-3 py-3 sm:py-2 text-base"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">終了時刻</label>
              <input
                type="time"
                value={shift.endTime}
                onChange={(e) => setShift({ ...shift, endTime: e.target.value })}
                className="w-full border rounded-md px-3 py-3 sm:py-2 text-base"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
            <textarea
              value={shift.note || ''}
              onChange={(e) => setShift({ ...shift, note: e.target.value })}
              className="w-full border rounded-md px-3 py-3 sm:py-2 text-base"
              rows={3}
            />
          </div>
        </div>

        <div className="flex justify-between mt-6 pb-4 sm:pb-0">
          <div>
            {editingId && (
              <button
                onClick={() => onDelete(editingId)}
                className="px-4 py-3 sm:py-2 text-red-600 hover:text-red-800"
              >
                削除
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-3 sm:py-2 border rounded-md hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-3 sm:py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
            >
              {editingId ? '更新' : '追加'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});