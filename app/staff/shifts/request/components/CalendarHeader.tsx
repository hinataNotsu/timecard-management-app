'use client';

import { memo } from 'react';
import type { ViewMode, StatusFilter } from '../utils/types';

interface CalendarHeaderProps {
  viewMode: ViewMode;
  currentDate: Date;
  targetMonth: Date;
  statusFilter: StatusFilter;
  isSubmissionLocked: boolean;
  deadlineMessage: string;
  onViewModeChange: (mode: ViewMode) => void;
  onNavigate: (direction: 'prev' | 'next' | 'today') => void;
  onStatusFilterChange: (filter: StatusFilter) => void;
  onBackClick: () => void;
}

export const CalendarHeader = memo(function CalendarHeader({
  viewMode,
  currentDate,
  targetMonth,
  statusFilter,
  isSubmissionLocked,
  deadlineMessage,
  onViewModeChange,
  onNavigate,
  onStatusFilterChange,
  onBackClick,
}: CalendarHeaderProps) {
  const getDisplayDate = () => {
    if (viewMode === 'month') {
      return `${targetMonth.getFullYear()}年${targetMonth.getMonth() + 1}月`;
    } else if (viewMode === 'week') {
      const startOfWeek = new Date(currentDate);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      return `${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()} - ${endOfWeek.getMonth() + 1}/${endOfWeek.getDate()}`;
    } else {
      return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月${currentDate.getDate()}日`;
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold text-gray-900">シフト提出</h1>
        <button
          onClick={onBackClick}
          className="px-4 py-2 text-gray-600 hover:text-gray-900"
        >
          ← ダッシュボードに戻る
        </button>
      </div>

      {/* 締め切り表示 */}
      {!isSubmissionLocked ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-blue-800">📅 {deadlineMessage}</p>
        </div>
      ) : (
        <div className="bg-gray-100 border border-gray-300 rounded-lg p-3 mb-4">
          <p className="text-sm text-gray-600">🔒 {deadlineMessage}</p>
        </div>
      )}

      {/* コントロール */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        {/* ビューモード切替 */}
        <div className="flex rounded-md overflow-hidden border">
          {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={`px-4 py-2 text-sm ${viewMode === mode ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-50'}`}
            >
              {mode === 'month' ? '月' : mode === 'week' ? '週' : '日'}
            </button>
          ))}
        </div>

        {/* ナビゲーション */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('prev')}
            className="px-3 py-2 border rounded-md hover:bg-gray-50"
          >
            ←
          </button>
          <button
            onClick={() => onNavigate('today')}
            className="px-3 py-2 border rounded-md hover:bg-gray-50"
          >
            今日
          </button>
          <button
            onClick={() => onNavigate('next')}
            className="px-3 py-2 border rounded-md hover:bg-gray-50"
          >
            →
          </button>
        </div>

        {/* 日付表示 */}
        <span className="text-lg font-semibold">{getDisplayDate()}</span>

        {/* ステータスフィルター */}
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as StatusFilter)}
          className="border rounded-md px-3 py-2"
        >
          <option value="all">すべて</option>
          <option value="pending">未承認</option>
          <option value="approved">承認済</option>
          <option value="rejected">却下</option>
        </select>
      </div>
    </div>
  );
});