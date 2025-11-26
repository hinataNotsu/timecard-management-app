'use client';

import { memo } from 'react';
import { classesForStatus } from '../utils/styleUtils';
import type { ShiftEntry } from '../utils/types';

interface ShiftCardProps {
  shift: ShiftEntry;
  viewType: 'month' | 'week' | 'day';
  pixelPerHour: number;
  isLocked: boolean;
  onClick: () => void;
  onResizeStart?: (edge: 'start' | 'end', startY: number) => void;
}

export const ShiftCard = memo(function ShiftCard({
  shift,
  viewType,
  pixelPerHour,
  isLocked,
  onClick,
  onResizeStart,
}: ShiftCardProps) {
  const startHour = parseInt(shift.startTime.split(':')[0]);
  const startMin = parseInt(shift.startTime.split(':')[1]);
  const endHour = parseInt(shift.endTime.split(':')[0]);
  const endMin = parseInt(shift.endTime.split(':')[1]);
  const top = (startHour + startMin / 60) * pixelPerHour;
  const height = ((endHour + endMin / 60) - (startHour + startMin / 60)) * pixelPerHour;

  if (viewType === 'month') {
    return (
      <button
        onClick={onClick}
        className={`w-full text-left text-xs px-1 py-0.5 rounded truncate ${classesForStatus(shift.status, 'month')}`}
      >
        {shift.startTime}-{shift.endTime}
      </button>
    );
  }

  const padding = viewType === 'week' ? 'p-1' : 'p-2';
  const margin = viewType === 'week' ? 'left-1 right-1' : 'left-2 right-2';
  const handleHeight = viewType === 'week' ? 'h-3' : 'h-4';

  return (
    <div
      className={`absolute ${margin} ${classesForStatus(shift.status, 'block')} ${viewType === 'week' ? 'text-xs' : ''} ${padding} rounded-md ${isLocked ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{ top: `${top}px`, height: `${height}px` }}
      onClick={onClick}
    >
      {!isLocked && onResizeStart && (
        <>
          <div
            className={`resize-handle absolute top-0 left-0 right-0 ${handleHeight} cursor-ns-resize`}
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeStart('start', e.pageY);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              onResizeStart('start', e.touches[0].pageY);
            }}
          />
          <div
            className={`resize-handle absolute bottom-0 left-0 right-0 ${handleHeight} cursor-ns-resize`}
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeStart('end', e.pageY);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              onResizeStart('end', e.touches[0].pageY);
            }}
          />
        </>
      )}
      <div className="font-semibold pointer-events-none">
        {shift.startTime}-{shift.endTime}
      </div>
      {shift.note && (
        <div className="mt-1 pointer-events-none pb-2">{shift.note}</div>
      )}
    </div>
  );
});

// 一時シフト表示用
interface TempShiftCardProps {
  tempShift: { date: string; startTime: string; endTime: string };
  pixelPerHour: number;
  viewType: 'week' | 'day';
}

export const TempShiftCard = memo(function TempShiftCard({ tempShift, pixelPerHour, viewType }: TempShiftCardProps) {
  const startHour = parseInt(tempShift.startTime.split(':')[0]);
  const startMin = parseInt(tempShift.startTime.split(':')[1]);
  const endHour = parseInt(tempShift.endTime.split(':')[0]);
  const endMin = parseInt(tempShift.endTime.split(':')[1]);
  const top = (startHour + startMin / 60) * pixelPerHour;
  const height = ((endHour + endMin / 60) - (startHour + startMin / 60)) * pixelPerHour;

  const margin = viewType === 'week' ? 'left-1 right-1' : 'left-2 right-2';
  const padding = viewType === 'week' ? 'p-1' : 'p-2';
  const textSize = viewType === 'week' ? 'text-xs' : '';

  return (
    <div
      className={`absolute ${margin} bg-blue-300 bg-opacity-50 ${padding} ${textSize} rounded pointer-events-none border-2 border-blue-500 border-dashed`}
      style={{ top: `${top}px`, height: `${height}px`, willChange: 'transform, height' }}
    >
      <div className="font-semibold">{tempShift.startTime}-{tempShift.endTime}</div>
    </div>
  );
});