'use client';

import { memo, useMemo } from 'react';
import JapaneseHolidays from 'japanese-holidays';
import { getCalendarDays, formatDate, isSameDate, DAY_NAMES } from '../utils/dateUtils';
import { classesForStatus } from '../utils/styleUtils';
import type { ShiftEntry } from '../utils/types';

interface MonthViewProps {
  currentDate: Date;
  shifts: ShiftEntry[];
  canSubmitForDate: (date: Date) => boolean;
  matchesFilter: (s: ShiftEntry) => boolean;
  onShiftClick: (shift: ShiftEntry) => void;
  onDateClick: (dateStr: string) => void;
}

// 日付セルコンポーネント（メモ化）
const DayCell = memo(function DayCell({
  day,
  index,
  currentMonth,
  shifts,
  canSubmitForDate,
  matchesFilter,
  onShiftClick,
  onDateClick,
}: {
  day: Date;
  index: number;
  currentMonth: number;
  shifts: ShiftEntry[];
  canSubmitForDate: (date: Date) => boolean;
  matchesFilter: (s: ShiftEntry) => boolean;
  onShiftClick: (shift: ShiftEntry) => void;
  onDateClick: (dateStr: string) => void;
}) {
  const dateStr = formatDate(day);
  const isCurrentMonth = day.getMonth() === currentMonth;
  const isToday = isSameDate(day, new Date());
  const holiday = JapaneseHolidays.isHoliday(day);
  const dayOfWeek = day.getDay();
  const isLockedDay = !canSubmitForDate(day);

  const dayShifts = useMemo(() => 
    shifts.filter(s => s.date === dateStr).filter(matchesFilter),
    [shifts, dateStr, matchesFilter]
  );

  return (
    <div
      className={`min-h-24 p-1 border-b border-r border-gray-300 border-opacity-50 ${!isCurrentMonth ? 'bg-gray-50 opacity-50' : ''} ${isToday ? 'bg-blue-50' : ''} ${isLockedDay ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
      onClick={() => {
        if (!isLockedDay) {
          onDateClick(dateStr);
        }
      }}
    >
      <div className={`text-sm font-semibold mb-1 ${holiday || dayOfWeek === 0 ? 'text-red-600' : dayOfWeek === 6 ? 'text-blue-600' : ''}`}>
        {day.getDate()}
        {holiday && <span className="text-xs ml-1">({holiday})</span>}
      </div>
      <div className="space-y-1">
        {dayShifts.slice(0, 3).map(shift => (
          <button
            key={shift.id}
            onClick={(e) => {
              e.stopPropagation();
              onShiftClick(shift);
            }}
            className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${classesForStatus(shift.status, 'month')}`}
          >
            {shift.startTime}-{shift.endTime}
          </button>
        ))}
        {dayShifts.length > 3 && (
          <div className="text-xs text-gray-500">+{dayShifts.length - 3}件</div>
        )}
      </div>
    </div>
  );
});

export const MonthView = memo(function MonthView({
  currentDate,
  shifts,
  canSubmitForDate,
  matchesFilter,
  onShiftClick,
  onDateClick,
}: MonthViewProps) {
  const days = useMemo(() => getCalendarDays(currentDate), [currentDate]);
  const currentMonth = currentDate.getMonth();

  return (
    <div className="bg-white rounded-lg shadow">
      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 border-b border-gray-300 border-opacity-50">
        {DAY_NAMES.map((day, index) => (
          <div
            key={day}
            className={`p-3 text-center font-semibold border-r border-gray-300 border-opacity-50 last:border-r-0 ${index === 0 ? 'text-red-600' : index === 6 ? 'text-blue-600' : ''}`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 日付グリッド */}
      <div className="grid grid-cols-7">
        {days.map((day, index) => (
          <DayCell
            key={index}
            day={day}
            index={index}
            currentMonth={currentMonth}
            shifts={shifts}
            canSubmitForDate={canSubmitForDate}
            matchesFilter={matchesFilter}
            onShiftClick={onShiftClick}
            onDateClick={onDateClick}
          />
        ))}
      </div>
    </div>
  );
});