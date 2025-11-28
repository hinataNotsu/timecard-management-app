'use client';

import { useState } from 'react';
import { GroupedTimecard, OrgSettings } from '@/lib/payroll';
import { TimecardItem } from './TimecardItem';

interface TimecardListProps {
  groupedTimecards: GroupedTimecard[];
  orgSettings: OrgSettings | null;
  transportPerShift: number;
}

export const TimecardList = ({
  groupedTimecards,
  orgSettings,
  transportPerShift,
}: TimecardListProps) => {
  const [expandedDateKey, setExpandedDateKey] = useState<string | null>(null);

  const toggleExpand = (dateKey: string) => {
    setExpandedDateKey(prev => prev === dateKey ? null : dateKey);
  };

  if (groupedTimecards.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        タイムカードがありません
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {groupedTimecards.map(group => (
        <TimecardItem
          key={group.dateKey}
          group={group}
          isExpanded={expandedDateKey === group.dateKey}
          onToggle={() => toggleExpand(group.dateKey)}
          orgSettings={orgSettings}
          transportPerShift={transportPerShift}
        />
      ))}
    </div>
  );
};