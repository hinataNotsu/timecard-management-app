'use client';

import { memo, useMemo, useCallback } from 'react';
import JapaneseHolidays from 'japanese-holidays';
import { ShiftCard, TempShiftCard } from './ShiftCard';
import { getWeekDays, getHourLabels, formatDate, isSameDate, DAY_NAMES } from '../utils/dateUtils';
import type { ShiftEntry, TempShift } from '../utils/types';

interface WeekViewProps {
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
const HourCell = memo(function HourCell({
  hour,
  dateStr,
  isLockedDay,
  pixelPerHour,
  onMouseDown,
  onTouchStart,
}: {
  hour: string;
  dateStr: string;
  isLockedDay: boolean;
  pixelPerHour: number;
  onMouseDown: (dateStr: string, clientY: number, startMin: number) => void;
  onTouchStart: (dateStr: string, clientY: number, startMin: number) => void;
}) {
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isLockedDay) return;
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutes = Math.round((offsetY / (pixelPerHour * 24)) * 24 * 60 / 15) * 15;
    onMouseDown(dateStr, e.clientY, minutes);
  }, [isLockedDay, dateStr, pixelPerHour, onMouseDown]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (isLockedDay) return;
    const touch = e.touches[0];
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    const offsetY = touch.clientY - rect.top;
    const minutes = Math.round((offsetY / (pixelPerHour * 24)) * 24 * 60 / 15) * 15;
    onTouchStart(dateStr, touch.clientY, minutes);
  }, [isLockedDay, dateStr, pixelPerHour, onTouchStart]);

  return (
    <div
      className={`h-12 border-b border-gray-300 border-opacity-50 ${isLockedDay ? 'cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'}`}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    />
  );
});

// 日カラムコンポーネント（メモ化）
const DayColumn = memo(function DayColumn({
  day,
  dayIndex,
  shifts,
  tempShift,
  hours,
  pixelPerHour,
  canSubmitForDate,
  matchesFilter,
  onShiftClick,
  onCellMouseDown,
  onCellTouchStart,
  onResizeStart,
}: {
  day: Date;
  dayIndex: number;
  shifts: ShiftEntry[];
  tempShift: TempShift | null;
  hours: string[];
  pixelPerHour: number;
  canSubmitForDate: (date: Date) => boolean;
  matchesFilter: (s: ShiftEntry) => boolean;
  onShiftClick: (shift: ShiftEntry) => void;
  onCellMouseDown: (dateStr: string, clientY: number, startMin: number) => void;
  onCellTouchStart: (dateStr: string, clientY: number, startMin: number) => void;
  onResizeStart: (id: string, edge: 'start' | 'end', originalStart: string, originalEnd: string, startY: number) => void;
}) {
  const dateStr = formatDate(day);
  const isToday = isSameDate(day, new Date());
  const dayOfWeek = day.getDay();
  const holiday = JapaneseHolidays.isHoliday(day);
  const isLockedDay = !canSubmitForDate(day);

  // このカラムのシフトをメモ化
  const dayShifts = useMemo(() => 
    shifts.filter(s => s.date === dateStr).filter(matchesFilter),
    [shifts, dateStr, matchesFilter]
  );

  // このカラムにtempShiftがあるか
  const hasTempShift = tempShift && tempShift.date === dateStr;

  return (
    <div className="border-r border-gray-300 border-opacity-50 last:border-r-0 min-w-32">
      {/* ヘッダー */}
      <div className={`h-12 p-2 border-b border-gray-300 border-opacity-50 text-center ${isToday ? 'bg-blue-50 font-bold' : 'bg-gray-50'}`}>
        <div className={`text-xs ${holiday || dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : 'text-gray-600'}`}>
          {DAY_NAMES[dayOfWeek]}
        </div>
        <div className={`text-sm ${holiday || dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : ''}`}>
          {day.getDate()}
        </div>
      </div>

      {/* 時間グリッド */}
      <div className="relative">
        {hours.map((hour) => (
          <HourCell
            key={hour}
            hour={hour}
            dateStr={dateStr}
            isLockedDay={isLockedDay}
            pixelPerHour={pixelPerHour}
            onMouseDown={onCellMouseDown}
            onTouchStart={onCellTouchStart}
          />
        ))}

        {/* シフト表示 */}
        {dayShifts.map(shift => (
          <ShiftCard
            key={shift.id}
            shift={shift}
            viewType="week"
            pixelPerHour={pixelPerHour}
            isLocked={!canSubmitForDate(new Date(shift.date))}
            onClick={() => onShiftClick(shift)}
            onResizeStart={(edge, startY) => onResizeStart(shift.id!, edge, shift.startTime, shift.endTime, startY)}
          />
        ))}

        {/* 一時シフト */}
        {hasTempShift && (
          <TempShiftCard tempShift={tempShift!} pixelPerHour={pixelPerHour} viewType="week" />
        )}
      </div>
    </div>
  );
});

export const WeekView = memo(function WeekView({
  currentDate,
  shifts,
  tempShift,
  canSubmitForDate,
  matchesFilter,
  onShiftClick,
  onCellMouseDown,
  onCellTouchStart,
  onResizeStart,
}: WeekViewProps) {
  const days = useMemo(() => getWeekDays(currentDate), [currentDate]);
  const hours = useMemo(() => getHourLabels(), []);
  const pixelPerHour = 48;

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto" style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}>
      <div className="flex min-w-max">
        {/* 時間軸 */}
        <div className="w-10 flex-shrink-0 sticky left-0 bg-gray-50 border-r border-gray-300 border-opacity-50 z-10">
          <div className="h-12 border-b border-gray-300 border-opacity-50"></div>
          {hours.map(hour => (
            <div key={hour} className="h-12 px-1 pt-1 text-xs text-gray-600 border-b border-gray-300 border-opacity-50 flex items-start">
              {hour}
            </div>
          ))}
        </div>

        {/* 曜日カラム */}
        <div className="flex-1 grid grid-cols-7">
          {days.map((day, dayIndex) => (
            <DayColumn
              key={dayIndex}
              day={day}
              dayIndex={dayIndex}
              shifts={shifts}
              tempShift={tempShift}
              hours={hours}
              pixelPerHour={pixelPerHour}
              canSubmitForDate={canSubmitForDate}
              matchesFilter={matchesFilter}
              onShiftClick={onShiftClick}
              onCellMouseDown={onCellMouseDown}
              onCellTouchStart={onCellTouchStart}
              onResizeStart={onResizeStart}
            />
          ))}
        </div>
      </div>
    </div>
  );
});