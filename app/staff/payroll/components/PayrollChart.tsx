'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChartDataItem } from '../types';
import { getBarColor } from '../utils/payrollCalculations';

interface PayrollChartProps {
  chartData: ChartDataItem[];
}

export const PayrollChart = ({ chartData }: PayrollChartProps) => {
  if (chartData.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">日別勤務時間</h3>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} unit="h" />
            <Tooltip
              formatter={(value: number) => [`${value}h`, '勤務時間']}
              labelFormatter={(label: number) => `${label}日`}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getBarColor(entry.status)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-3 mt-2 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500"></span>承認済</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500"></span>申請中</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500"></span>却下</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-400"></span>下書き</span>
      </div>
    </div>
  );
};