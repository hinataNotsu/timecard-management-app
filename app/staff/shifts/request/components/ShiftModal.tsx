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
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center transition-colors duration-300 overflow-hidden ${isVisible ? 'bg-black/30' : 'bg-transparent'}`}
      onClick={handleClose}
    >
      <div 
        ref={sheetRef}
        className={`bg-white rounded-t-2xl sm:rounded-lg w-full sm:w-[500px] max-w-full max-h-[85vh] overflow-y-auto overflow-x-hidden ${isDragging ? '' : 'transition-transform duration-300 ease-out'} ${isVisible && dragY === 0 ? 'translate-y-0 sm:scale-100 sm:opacity-100' : !isVisible ? 'translate-y-full sm:translate-y-0 sm:scale-95 sm:opacity-0' : ''}`}
        style={{ 
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* ドラッグハンドル（スマホ用） */}
        <div className="sm:hidden flex justify-center pt-3 pb-2 cursor-grab">
          <div className="w-12 h-1.5 bg-gray-300 rounded-full"></div>
        </div>

        <div className="px-5 sm:px-6 pb-6 sm:py-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              {editingId ? 'シフト編集' : 'シフト追加'}
            </h3>
            {editingId && (
              <button
                onClick={() => {
                  handleClose();
                  onDelete(editingId);
                }}
                className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                aria-label="削除"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>

          <div className="space-y-4 sm:space-y-3 w-full">
            {/* PC: 日付と時間を1行に */}
            <div className="hidden sm:grid sm:grid-cols-3 gap-3 w-full">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 text-left">日付</label>
                <input
                  type="date"
                  value={shift.date}
                  onChange={(e) => setShift({ ...shift, date: e.target.value })}
                  className="w-full box-border border border-gray-300 rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 text-left">開始時刻</label>
                <input
                  type="time"
                  value={shift.startTime}
                  onChange={(e) => setShift({ ...shift, startTime: e.target.value })}
                  className="w-full box-border border border-gray-300 rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 text-left">終了時刻</label>
                <input
                  type="time"
                  value={shift.endTime}
                  onChange={(e) => setShift({ ...shift, endTime: e.target.value })}
                  className="w-full box-border border border-gray-300 rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            
            {/* スマホ: テスト - 日付をtextareaで表示 */}
            <div className="px-4 sm:px-0 w-full sm:hidden">
              <label className="block text-sm font-medium text-gray-700 mb-1 text-left">日付（テスト）</label>
              <textarea
                value={shift.date}
                onChange={(e) => setShift({ ...shift, date: e.target.value })}
                className="w-full box-border border border-gray-300 rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={1}
                placeholder="YYYY-MM-DD"
              />
            </div>
            <div className="px-4 sm:px-0 w-full sm:hidden">
              <label className="block text-sm font-medium text-gray-700 mb-1 text-left">開始時刻</label>
              <input
                type="time"
                value={shift.startTime}
                onChange={(e) => setShift({ ...shift, startTime: e.target.value })}
                className="w-full box-border border border-gray-300 rounded-lg px-3 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="px-4 sm:px-0 w-full sm:hidden">
              <label className="block text-sm font-medium text-gray-700 mb-1 text-left">終了時刻</label>
              <input
                type="time"
                value={shift.endTime}
                onChange={(e) => setShift({ ...shift, endTime: e.target.value })}
                className="w-full box-border border border-gray-300 rounded-lg px-3 py-3 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            <div className="px-4 sm:px-0 w-full">
              <label className="block text-sm font-medium text-gray-700 mb-1 text-left">備考</label>
              <textarea
                value={shift.note || ''}
                onChange={(e) => setShift({ ...shift, note: e.target.value })}
                className="w-full box-border border border-gray-300 rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={2}
                placeholder="任意で入力"
              />
            </div>
          </div>

          {/* ボタン */}
          <div className="mt-6 flex gap-2 w-full sm:justify-end">
            <button
              onClick={handleClose}
              className="flex-1 sm:flex-none px-4 py-3 sm:py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleSubmit}
              className="flex-1 sm:flex-none px-6 py-3 sm:py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
            >
              {editingId ? '更新' : '追加'}
            </button>
          </div>
        </div>
        
        {/* Safe area padding for iPhone */}
        <div className="h-safe sm:hidden"></div>
      </div>
    </div>
  );
});