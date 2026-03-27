import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush, Legend } from 'recharts';
import { BollingerBands, RSI, MACD } from 'technicalindicators';

interface StockChartProps {
  data: any[];
  dataKey?: string;
  dateKey?: string;
}

const StockChart: React.FC<StockChartProps> = ({ data, dataKey = 'close', dateKey = 'date' }) => {
  const closePrices = data.map(item => item[dataKey]);
  
  const bb = new BollingerBands({ period: 20, stdDev: 2, values: closePrices });
  const bbResults = bb.getResult();

  const rsi = new RSI({ period: 14, values: closePrices });
  const rsiResults = rsi.getResult();

  const macd = new MACD({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, values: closePrices, SimpleMAOscillator: false, SimpleMASignal: false });
  const macdResults = macd.getResult();

  const chartData = data.map((item, index) => {
    const bbItem = bbResults[index - 19];
    const rsiItem = rsiResults[index - 13];
    const macdItem = macdResults[index - 34];
    return {
      date: (typeof item[dateKey] === 'string' ? new Date(item[dateKey]) : new Date(item[dateKey])).toISOString().split('T')[0],
      value: item[dataKey],
      upper: bbItem ? bbItem.upper : null,
      middle: bbItem ? bbItem.middle : null,
      lower: bbItem ? bbItem.lower : null,
      rsi: rsiItem ?? null,
      macd: macdItem ? macdItem.MACD : null,
      signal: macdItem ? macdItem.signal : null,
    };
  });

  return (
    <div className="space-y-4">
      <div className="h-96 w-full bg-white p-4 rounded-xl shadow-sm border border-zinc-200">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis domain={['auto', 'auto']} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} name="Price" />
            <Line type="monotone" dataKey="upper" stroke="#f59e0b" strokeWidth={1} dot={false} name="Upper BB" />
            <Line type="monotone" dataKey="middle" stroke="#6366f1" strokeWidth={1} dot={false} name="Middle BB" />
            <Line type="monotone" dataKey="lower" stroke="#f59e0b" strokeWidth={1} dot={false} name="Lower BB" />
            <Brush dataKey="date" height={30} stroke="#10b981" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="h-64 w-full bg-white p-4 rounded-xl shadow-sm border border-zinc-200">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis yAxisId="left" domain={[0, 100]} />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="rsi" stroke="#8884d8" strokeWidth={2} dot={false} name="RSI" />
            <Line yAxisId="right" type="monotone" dataKey="macd" stroke="#ff7300" strokeWidth={2} dot={false} name="MACD" />
            <Line yAxisId="right" type="monotone" dataKey="signal" stroke="#ff0000" strokeWidth={2} dot={false} name="Signal" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default StockChart;
