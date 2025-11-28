'use client';

import { useState } from 'react';
import { TimecardRow as TimecardRowType, OrgSettings } from '@/lib/payroll';
import { calcBreakdown, getDayOfWeek } from '@/lib/payroll';
import { TimecardRow } from './TimecardRow';

interface TimecardDateGroupProps {
  dateKey: string;
  timecards: TimecardRowType[];
  transportPerDay: number;
  orgSettings: OrgSettings | null;
  onSaveEdit: (id: string, clockInAt: string, clockOutAt: string) => Promise<void>;
}

export const TimecardDateGroup = ({
  dateKey,
  timecards,
  transportPerDay,
  orgSettings,
  onSaveEdit,
}: TimecardDateGroupProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = getDayOfWeek(date);

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* 日付ヘッダー */}
      <div 
        className="px-4 py-2 bg-blue-50 flex items-center justify-between cursor-pointer hover:bg-blue-100"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-blue-800">
            📅 {dateKey}（{weekday}）
          </span>
          <span className="text-sm text-blue-600">
            {timecards.length}件
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-green-700">
            交通費: ¥{transportPerDay.toLocaleString()}
          </span>
          <span className="text-gray-400">{isCollapsed ? '▼' : '▲'}</span>
        </div>
      </div>
      
      {/* タイムカードテーブル */}
      {!isCollapsed && (
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 border-b text-center">出勤</th>
              <th className="p-2 border-b text-center">退勤</th>
              <th className="p-2 border-b text-center">休憩(分)</th>
              <th className="p-2 border-b text-center">勤務(分)</th>
              <th className="p-2 border-b text-center">深夜(分)</th>
              <th className="p-2 border-b text-center">残業(分)</th>
              <th className="p-2 border-b text-center">時給</th>
              <th className="p-2 border-b text-center">合計(円)</th>
              <th className="p-2 border-b text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {timecards.map((tc) => {
              const bd = calcBreakdown(tc, orgSettings);
              return (
                <TimecardRow
                  key={tc.id}
                  timecard={tc}
                  breakdown={bd}
                  orgSettings={orgSettings}
                  onSaveEdit={onSaveEdit}
                />
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
