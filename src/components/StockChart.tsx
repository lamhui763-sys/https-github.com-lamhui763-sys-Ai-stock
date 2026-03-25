import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush } from 'recharts';

interface StockChartProps {
  data: any[];
  dataKey?: string;
  dateKey?: string;
}

const StockChart: React.FC<StockChartProps> = ({ data, dataKey = 'close', dateKey = 'date' }) => {
  const chartData = data.map(item => ({
    date: (typeof item[dateKey] === 'string' ? new Date(item[dateKey]) : new Date(item[dateKey])).toISOString().split('T')[0],
    value: item[dataKey]
  }));

  return (
    <div className="h-80 w-full bg-white p-4 rounded-xl shadow-sm border border-zinc-200">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis domain={['auto', 'auto']} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} />
          <Brush dataKey="date" height={30} stroke="#10b981" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default StockChart;
