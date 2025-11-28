'use client';

import { GroupedTimecard, OrgSettings, calcBreakdown, formatTime, getDayOfWeek, getDayOfWeekColor, statusStyles, statusLabels } from '@/lib/payroll';

interface TimecardItemProps {
  group: GroupedTimecard;
  isExpanded: boolean;
  onToggle: () => void;
  orgSettings: OrgSettings | null;
  transportPerShift: number;
}

// ステータスバッジ
const StatusBadge = ({ status }: { status: string }) => {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyles[status] || 'bg-gray-100'}`}>
      {statusLabels[status] || status}
    </span>
  );
};

export const TimecardItem = ({
  group,
  isExpanded,
  onToggle,
  orgSettings,
  transportPerShift,
}: TimecardItemProps) => {
  const { dateKey, date, timecards, totalBreakdown } = group;
  const dayNum = parseInt(dateKey.split('-')[2], 10);
  const hasMultiple = timecards.length > 1;

  // グループ全体のステータスを決定
  const statuses = timecards.map(tc => tc.status);
  let groupStatus = 'draft';
  if (statuses.every(s => s === 'approved')) groupStatus = 'approved';
  else if (statuses.includes('pending')) groupStatus = 'pending';
  else if (statuses.includes('rejected')) groupStatus = 'rejected';

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* 折りたたみヘッダー */}
      <button
        onClick={onToggle}
        className="w-full p-4 text-left flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {/* 展開アイコン */}
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {/* 日付 */}
          <div className="flex items-center gap-2">
            <span className={`font-semibold ${getDayOfWeekColor(date)}`}>
              {dayNum}日 ({getDayOfWeek(date)})
            </span>
            {hasMultiple && (
              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                {timecards.length}件
              </span>
            )}
          </div>
        </div>
        {/* 概要 */}
        <div className="flex items-center gap-2 sm:gap-3 text-sm">
          <span className="text-gray-600">{(totalBreakdown.totalMin / 60).toFixed(1)}h</span>
          <span className="font-semibold text-gray-900">¥{totalBreakdown.total.toLocaleString()}</span>
          <StatusBadge status={groupStatus} />
        </div>
      </button>

      {/* 展開時の詳細 */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-gray-100">
          {timecards.map((tc, index) => {
            const bd = calcBreakdown(tc, orgSettings, transportPerShift);
            const isLast = index === timecards.length - 1;

            return (
              <div
                key={tc.id}
                className={`bg-gray-50 rounded-lg p-3 mt-2 ${!isLast ? 'mb-1' : ''}`}
              >
                {/* 複数シフトの場合はシフト番号を表示 */}
                {hasMultiple && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">
                      シフト {index + 1}
                    </span>
                    <StatusBadge status={tc.status} />
                  </div>
                )}

                {/* タイムライン形式の勤務情報 */}
                <div className="mb-3">
                  {/* 出勤〜退勤のタイムライン */}
                  <div className="flex items-center gap-2 mb-2">
                    {/* 出勤 */}
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <div>
                        <div className="text-lg font-bold text-gray-900">{formatTime(tc.clockInAt)}</div>
                        <div className="text-xs text-gray-500">出勤</div>
                      </div>
                    </div>
                    
                    {/* 矢印ライン */}
                    <div className="flex-1 flex items-center px-1">
                      <div className="flex-1 h-0.5 bg-gradient-to-r from-green-400 to-red-400"></div>
                      <svg className="w-3 h-3 text-red-400 -ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                    
                    {/* 退勤 */}
                    <div className="flex items-center gap-1.5">
                      <div>
                        <div className="text-lg font-bold text-gray-900">{formatTime(tc.clockOutAt)}</div>
                        <div className="text-xs text-gray-500">退勤</div>
                      </div>
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                    </div>
                  </div>
                  
                  {/* 勤務時間サマリー（休憩含む） */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
                      <span>⏱️</span>
                      <span className="font-semibold">実働 {(bd.totalMin / 60).toFixed(1)}h</span>
                    </div>
                    {bd.breakMin > 0 && (
                      <div className="flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-1 rounded-full">
                        <span>☕</span>
                        <span>休憩 {bd.breakMin}分</span>
                      </div>
                    )}
                    {bd.nightMin > 0 && (
                      <div className="flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full">
                        <span>🌙</span>
                        <span>深夜 {bd.nightMin}分</span>
                      </div>
                    )}
                    {bd.overtimeMin > 0 && (
                      <div className="flex items-center gap-1 bg-orange-50 text-orange-700 px-2 py-1 rounded-full">
                        <span>⚡</span>
                        <span>残業 {bd.overtimeMin}分</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 区切り線 */}
                <div className="border-t border-gray-200 my-2"></div>

                {/* 給与内訳 */}
                <div className="space-y-2 text-sm">
                  {transportPerShift > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">交通費</span>
                      <span className="font-medium">¥{transportPerShift.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600">基本給</span>
                    <span className="font-medium">¥{Math.round(bd.base).toLocaleString()}</span>
                  </div>
                  {bd.night > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">深夜手当</span>
                      <span className="font-medium">¥{Math.round(bd.night).toLocaleString()}</span>
                    </div>
                  )}
                  {bd.overtime > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">残業手当</span>
                      <span className="font-medium">¥{Math.round(bd.overtime).toLocaleString()}</span>
                    </div>
                  )}
                  {bd.holiday > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">休日手当</span>
                      <span className="font-medium">¥{Math.round(bd.holiday).toLocaleString()}</span>
                    </div>
                  )}

                  {/* シフト単位の合計 */}
                  <div className="border-t border-gray-200 pt-2 mt-2">
                    <div className="flex justify-between text-base font-semibold">
                      <span>{hasMultiple ? 'シフト小計' : '合計'}</span>
                      <span className="text-emerald-600">¥{bd.total.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* 複数シフトの場合は日計を表示 */}
          {hasMultiple && (
            <div className="bg-blue-50 rounded-lg p-4 mt-3">
              <div className="flex justify-between text-base font-bold">
                <span className="text-blue-800">日計</span>
                <span className="text-blue-800">¥{totalBreakdown.total.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm text-blue-700 mt-1">
                <span>合計勤務時間</span>
                <span>{(totalBreakdown.totalMin / 60).toFixed(1)}h</span>
              </div>
              {totalBreakdown.transport > 0 && (
                <div className="flex justify-between text-sm text-blue-700 mt-1">
                  <span>交通費</span>
                  <span>¥{totalBreakdown.transport.toLocaleString()}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};