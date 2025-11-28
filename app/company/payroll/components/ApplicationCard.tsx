'use client';

import { useState } from 'react';
import { UserApplication, OrgSettings, TimecardRow as TimecardRowType } from '@/lib/payroll';
import { TimecardDateGroup } from './TimecardDateGroup';

interface ApplicationCardProps {
  app: UserApplication;
  isAdditional: boolean;
  orgSettings: OrgSettings | null;
  memberTransport: Record<string, number>;
  onApprove: (userId: string) => void;
  onSaveEdit: (id: string, clockInAt: string, clockOutAt: string) => Promise<void>;
}

export const ApplicationCard = ({
  app,
  isAdditional,
  orgSettings,
  memberTransport,
  onApprove,
  onSaveEdit,
}: ApplicationCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // 日付ごとにグループ化
  const groupedByDate = new Map<string, TimecardRowType[]>();
  for (const tc of app.timecards) {
    if (!groupedByDate.has(tc.dateKey)) {
      groupedByDate.set(tc.dateKey, []);
    }
    groupedByDate.get(tc.dateKey)!.push(tc);
  }
  const sortedDates = Array.from(groupedByDate.keys()).sort();

  // 交通費を取得
  const transportPerDay = orgSettings?.transportAllowanceEnabled
    ? (memberTransport[app.userId] ?? orgSettings.transportAllowancePerShift ?? 0)
    : 0;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* ユーザーヘッダー */}
      <div 
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-4">
          <img src={app.avatarUrl} alt="" className="w-10 h-10 rounded-full" />
          <div>
            <div className="font-semibold">{app.userName}</div>
            <div className="text-sm text-gray-500">
              {app.workDays}日勤務 / {Math.floor(app.totalMinutes / 60)}時間{app.totalMinutes % 60}分
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-lg font-bold text-blue-600">¥{app.total.toLocaleString()}</div>
            <div className="text-xs text-gray-500">
              {isAdditional ? (
                <span className="text-blue-600">追加申請</span>
              ) : (
                <span className="text-yellow-600">申請中</span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onApprove(app.userId); }}
            className={`px-4 py-2 text-white rounded hover:opacity-90 ${
              isAdditional ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {isAdditional ? '追加承認' : '承認'}
          </button>
          <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* 詳細 */}
      {isExpanded && (
        <div className="border-t">
          {/* サマリー */}
          <div className="p-4 bg-gray-50 grid grid-cols-5 gap-4 text-sm">
            <div>
              <span className="text-gray-500">基本給:</span>
              <span className="ml-2 font-semibold">¥{Math.round(app.base).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">深夜:</span>
              <span className="ml-2 font-semibold">¥{Math.round(app.night).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">残業:</span>
              <span className="ml-2 font-semibold">¥{Math.round(app.overtime).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">休日:</span>
              <span className="ml-2 font-semibold">¥{Math.round(app.holiday).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">交通費:</span>
              <span className="ml-2 font-semibold">¥{Math.round(app.transport).toLocaleString()}</span>
            </div>
          </div>

          {/* タイムカード一覧 */}
          <div className="p-6 space-y-4">
            {sortedDates.map((dateKey) => (
              <TimecardDateGroup
                key={dateKey}
                dateKey={dateKey}
                timecards={groupedByDate.get(dateKey)!}
                transportPerDay={transportPerDay}
                orgSettings={orgSettings}
                onSaveEdit={onSaveEdit}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
