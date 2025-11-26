'use client';

import { memo, useMemo, useCallback } from 'react';
import JapaneseHolidays from 'japanese-holidays';
import { ShiftCard, TempShiftCard } from './ShiftCard';
import { getHourLabels, formatDate, DAY_NAMES } from '../utils/dateUtils';
import type { ShiftEntry, TempShift } from '../utils/types';

interface DayViewProps {
  currentDate: Date;
  shifts: ShiftEntry[];
  tempShift: TempShift | null;
  canSubmitForDate: (date: Date) => boolean;
  matchesFilter: (s: ShiftEntry) => boolean;
  onShiftClick: (shift: ShiftEntry) => void;
  onCellMouseDown: (dateStr: string, clientY: number, startMin: number) => void;
  onCellTouchStart: (dateStr: string, clientY: number, startMin: number) => void;
  onResizeStart: (id: string, edge: 'start' | 'end', originalStart: string, originalEnd: string, startY: number) => void;
}

// 時間セルコンポーネント（メモ化）
const DayHourCell = memo(function DayHourCell({
  hour,
  dateStr,
  isLockedDay,
  onMouseDown,
  onTouchStart,
}: {
  hour: string;
  dateStr: string;
  isLockedDay: boolean;
  onMouseDown: (dateStr: string, clientY: number, startMin: number) => void;
  onTouchStart: (dateStr: string, clientY: number, startMin: number) => void;
}) {
  const pixelPerHour = 64;

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isLockedDay) return;
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutes = Math.round((offsetY / pixelPerHour) * 60 / 15) * 15;
    onMouseDown(dateStr, e.clientY, minutes);
  }, [isLockedDay, dateStr, onMouseDown]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (isLockedDay) return;
    const touch = e.touches[0];
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    const offsetY = touch.clientY - rect.top;
    const minutes = Math.round((offsetY / pixelPerHour) * 60 / 15) * 15;
    onTouchStart(dateStr, touch.clientY, minutes);
  }, [isLockedDay, dateStr, onTouchStart]);

  return (
    <div
      className={`h-16 border-b border-gray-300 border-opacity-50 ${isLockedDay ? 'cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'}`}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    />
  );
});

export const DayView = memo(function DayView({
  currentDate,
  shifts,
  tempShift,
  canSubmitForDate,
  matchesFilter,
  onShiftClick,
  onCellMouseDown,
  onCellTouchStart,
  onResizeStart,
}: DayViewProps) {
  const dateStr = useMemo(() => formatDate(currentDate), [currentDate]);
  const hours = useMemo(() => getHourLabels(), []);
  const dayOfWeek = currentDate.getDay();
  const holiday = JapaneseHolidays.isHoliday(currentDate);
  const isLockedDay = !canSubmitForDate(currentDate);
  const pixelPerHour = 64;

  // シフトをメモ化
  const dayShifts = useMemo(() => 
    shifts.filter(s => s.date === dateStr).filter(matchesFilter),
    [shifts, dateStr, matchesFilter]
  );

  const hasTempShift = tempShift && tempShift.date === dateStr;

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <div className="flex min-w-max">
        {/* 時間軸 */}
        <div className="w-10 flex-shrink-0 sticky left-0 bg-gray-50 border-r border-gray-300 border-opacity-50">
          <div className="h-12 border-b border-gray-300 border-opacity-50 p-1 text-center text-xs font-semibold">時間</div>
          {hours.map(hour => (
            <div key={hour} className="h-16 px-1 pt-1 text-xs text-gray-600 border-b border-gray-300 border-opacity-50 flex items-start">
              {hour}
            </div>
          ))}
        </div>

        {/* 日付カラム */}
        <div className="flex-1 relative border-r border-gray-300 border-opacity-50">
          {/* ヘッダー */}
          <div className={`h-12 border-b border-gray-300 border-opacity-50 p-2 text-center font-semibold ${holiday || dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : ''}`}>
            {currentDate.getMonth() + 1}月{currentDate.getDate()}日({DAY_NAMES[dayOfWeek]})
          </div>

          {/* 時間グリッド */}
          <div>
            {hours.map((hour) => (
              <DayHourCell
                key={hour}
                hour={hour}
                dateStr={dateStr}
                isLockedDay={isLockedDay}
                onMouseDown={onCellMouseDown}
                onTouchStart={onCellTouchStart}
              />
            ))}

            {/* シフト表示 */}
            {dayShifts.map(shift => (
              <ShiftCard
                key={shift.id}
                shift={shift}
                viewType="day"
                pixelPerHour={pixelPerHour}
                isLocked={!canSubmitForDate(new Date(shift.date))}
                onClick={() => onShiftClick(shift)}
                onResizeStart={(edge, startY) => onResizeStart(shift.id!, edge, shift.startTime, shift.endTime, startY)}
              />
            ))}

            {/* 一時シフト */}
            {hasTempShift && (
              <TempShiftCard tempShift={tempShift!} pixelPerHour={pixelPerHour} viewType="day" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});