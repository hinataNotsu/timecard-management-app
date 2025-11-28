'use client';

import { useRef, useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChartDataItem, getBarColor } from '@/lib/payroll';

interface PayrollChartProps {
  chartData: ChartDataItem[];
}

const MIN_BAR_WIDTH = 30; // 最小バー幅（px）

export const PayrollChart = ({ chartData }: PayrollChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  if (chartData.length === 0) return null;

  // データ数に応じた最小幅とコンテナ幅の大きい方を採用
  const minRequiredWidth = chartData.length * MIN_BAR_WIDTH;
  const chartWidth = Math.max(minRequiredWidth, containerWidth);
  const needsScroll = minRequiredWidth > containerWidth;

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">日別勤務時間</h3>
      <div ref={containerRef} className="overflow-x-auto">
        {containerWidth > 0 && (
          <div style={{ width: needsScroll ? chartWidth : '100%', height: 160 }}>
            {needsScroll ? (
              <BarChart 
                data={chartData} 
                width={chartWidth}
                height={160}
                margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
              >
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
            ) : (
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
            )}
          </div>
        )}
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