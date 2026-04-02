import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush, Legend, ComposedChart, Scatter } from 'recharts';
import { BollingerBands, RSI, MACD, SMA } from 'technicalindicators';

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

  const shortSMA = new SMA({ period: 5, values: closePrices });
  const shortSMAResults = shortSMA.getResult();

  const longSMA = new SMA({ period: 20, values: closePrices });
  const longSMAResults = longSMA.getResult();

  const chartData = data.map((item, index) => {
    const bbItem = bbResults[index - 19];
    const rsiItem = rsiResults[index - 13];
    const macdItem = macdResults[index - 34];
    const sSMA = shortSMAResults[index - 4];
    const lSMA = longSMAResults[index - 19];

    // Detect crossover
    let buySignal = null;
    let sellSignal = null;
    
    if (index > 0) {
      const prevSSMA = shortSMAResults[index - 5];
      const prevLSMA = longSMAResults[index - 20];
      
      if (prevSSMA !== undefined && prevLSMA !== undefined && sSMA !== undefined && lSMA !== undefined) {
        if (prevSSMA <= prevLSMA && sSMA > lSMA) {
          buySignal = sSMA;
        } else if (prevSSMA >= prevLSMA && sSMA < lSMA) {
          sellSignal = sSMA;
        }
      }
    }

    return {
      date: (typeof item[dateKey] === 'string' ? new Date(item[dateKey]) : new Date(item[dateKey])).toISOString().split('T')[0],
      value: item[dataKey],
      upper: bbItem ? bbItem.upper : null,
      middle: bbItem ? bbItem.middle : null,
      lower: bbItem ? bbItem.lower : null,
      rsi: rsiItem ?? null,
      macd: macdItem ? macdItem.MACD : null,
      signal: macdItem ? macdItem.signal : null,
      shortSMA: sSMA ?? null,
      longSMA: lSMA ?? null,
      buySignal,
      sellSignal,
    };
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-zinc-200 rounded-lg shadow-lg text-xs">
          <p className="font-bold mb-1">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(2) : (entry.value ?? 'N/A')}
            </p>
          ))}
          {payload[0]?.payload.buySignal && <p className="text-emerald-600 font-bold mt-1">✨ 黃金交叉 (買入信號)</p>}
          {payload[0]?.payload.sellSignal && <p className="text-red-600 font-bold mt-1">💀 死亡交叉 (賣出信號)</p>}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="h-96 w-full bg-white p-4 rounded-xl shadow-sm border border-zinc-200">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{fontSize: 10}} />
            <YAxis domain={['auto', 'auto']} tick={{fontSize: 10}} orientation="right" />
            <Tooltip content={<CustomTooltip />} />
            <Legend verticalAlign="top" height={36} />
            <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} name="價格" />
            <Line type="monotone" dataKey="shortSMA" stroke="#ef4444" strokeWidth={1.5} dot={false} name="5日均線" strokeDasharray="5 5" />
            <Line type="monotone" dataKey="longSMA" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="20日均線" strokeDasharray="5 5" />
            
            <Scatter name="買入信號" dataKey="buySignal" fill="#10b981" shape="circle" />
            <Scatter name="賣出信號" dataKey="sellSignal" fill="#ef4444" shape="circle" />
            
            <Line type="monotone" dataKey="upper" stroke="#f59e0b" strokeWidth={1} dot={false} name="布林上軌" opacity={0.3} />
            <Line type="monotone" dataKey="middle" stroke="#6366f1" strokeWidth={1} dot={false} name="布林中軌" opacity={0.3} />
            <Line type="monotone" dataKey="lower" stroke="#f59e0b" strokeWidth={1} dot={false} name="布林下軌" opacity={0.3} />
            <Brush dataKey="date" height={30} stroke="#10b981" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="h-64 w-full bg-white p-4 rounded-xl shadow-sm border border-zinc-200">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{fontSize: 10}} />
            <YAxis yAxisId="left" domain={[0, 100]} tick={{fontSize: 10}} />
            <YAxis yAxisId="right" orientation="right" tick={{fontSize: 10}} />
            <Tooltip />
            <Legend verticalAlign="top" height={36} />
            <Line yAxisId="left" type="monotone" dataKey="rsi" stroke="#8884d8" strokeWidth={2} dot={false} name="RSI" />
            <Line yAxisId="right" type="monotone" dataKey="macd" stroke="#ff7300" strokeWidth={2} dot={false} name="MACD" />
            <Line yAxisId="right" type="monotone" dataKey="signal" stroke="#ff0000" strokeWidth={2} dot={false} name="信號線" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default StockChart;
