'use client';

import { useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { TimecardRow as TimecardRowType, OrgSettings, PayrollBreakdown } from '@/lib/payroll';
import { formatTime } from '@/lib/payroll';

interface TimecardRowProps {
  timecard: TimecardRowType;
  breakdown: PayrollBreakdown;
  orgSettings: OrgSettings | null;
  onSaveEdit: (id: string, clockInAt: string, clockOutAt: string) => Promise<void>;
}

export const TimecardRow = ({
  timecard,
  breakdown,
  orgSettings,
  onSaveEdit,
}: TimecardRowProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    clockInAt: '',
    clockOutAt: '',
  });

  const startEdit = () => {
    const fmt = (ts?: Timestamp) => ts ? ts.toDate().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
    setIsEditing(true);
    setEditForm({
      clockInAt: fmt(timecard.clockInAt),
      clockOutAt: fmt(timecard.clockOutAt),
    });
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditForm({ clockInAt: '', clockOutAt: '' });
  };

  const saveEdit = async () => {
    await onSaveEdit(timecard.id, editForm.clockInAt, editForm.clockOutAt);
    setIsEditing(false);
    setEditForm({ clockInAt: '', clockOutAt: '' });
  };

  return (
    <tr className="hover:bg-gray-50">
      <td className="p-2 border-b text-center">
        {isEditing ? (
          <input 
            type="time" 
            value={editForm.clockInAt} 
            onChange={(e) => setEditForm(prev => ({ ...prev, clockInAt: e.target.value }))}
            className="px-2 py-1 border rounded text-sm w-24"
          />
        ) : formatTime(timecard.clockInAt)}
      </td>
      <td className="p-2 border-b text-center">
        {isEditing ? (
          <input 
            type="time" 
            value={editForm.clockOutAt} 
            onChange={(e) => setEditForm(prev => ({ ...prev, clockOutAt: e.target.value }))}
            className="px-2 py-1 border rounded text-sm w-24"
          />
        ) : formatTime(timecard.clockOutAt)}
      </td>
      <td className="p-2 border-b text-center">{breakdown.breakMin}</td>
      <td className="p-2 border-b text-center">{breakdown.totalMin}</td>
      <td className="p-2 border-b text-center">{breakdown.nightMin}</td>
      <td className="p-2 border-b text-center">{breakdown.overtimeMin}</td>
      <td className="p-2 border-b text-center">
        ¥{timecard.hourlyWage ?? orgSettings?.defaultHourlyWage ?? 1100}
      </td>
      <td className="p-2 border-b text-center font-semibold">
        ¥{breakdown.total.toLocaleString('ja-JP')}
      </td>
      <td className="p-2 border-b text-center">
        {isEditing ? (
          <div className="flex gap-1 justify-center">
            <button
              onClick={saveEdit}
              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            >
              保存
            </button>
            <button
              onClick={cancelEdit}
              className="px-2 py-1 bg-gray-300 rounded text-xs hover:bg-gray-400"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={startEdit}
            className="px-2 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300"
          >
            編集
          </button>
        )}
      </td>
    </tr>
  );
};
