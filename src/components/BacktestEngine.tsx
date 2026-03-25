import { useState } from 'react';
import { motion } from 'motion/react';
import StockChart from './StockChart';

export default function BacktestEngine() {
  const [strategy, setStrategy] = useState('SMA');
  const [symbol, setSymbol] = useState('^HSI');
  const [shortPeriod, setShortPeriod] = useState(5);
  const [longPeriod, setLongPeriod] = useState(20);
  const [initialCapital, setInitialCapital] = useState(100000);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);

  const handleBacktest = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, symbol, shortPeriod, longPeriod, initialCapital }),
      });
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error('Backtest error:', error);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h2 className="text-2xl font-bold text-zinc-900">回测引擎</h2>
      
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-4">
        <h3 className="font-semibold text-lg">回测配置</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} className="p-3 border rounded-xl">
            <option value="SMA">移动平均交叉</option>
            <option value="RSI">RSI</option>
            <option value="MACD">MACD</option>
            <option value="KKMA">KKMA</option>
          </select>
          <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="p-3 border rounded-xl" placeholder="股票代码" />
          <input type="number" value={shortPeriod} onChange={(e) => setShortPeriod(Number(e.target.value))} className="p-3 border rounded-xl" placeholder="短期均线" />
          <input type="number" value={longPeriod} onChange={(e) => setLongPeriod(Number(e.target.value))} className="p-3 border rounded-xl" placeholder="长期均线" />
          <input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))} className="p-3 border rounded-xl" placeholder="初始资金" />
        </div>
        <button onClick={handleBacktest} disabled={loading} className="w-full bg-emerald-500 text-white p-3 rounded-xl font-medium hover:bg-emerald-600">
          {loading ? '回测中...' : '开始回测'}
        </button>
      </div>

      {results && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl shadow-sm border"><p className="text-sm text-zinc-500">总收益</p><p className="text-xl font-bold">{results.totalReturn}%</p></div>
            <div className="bg-white p-4 rounded-xl shadow-sm border"><p className="text-sm text-zinc-500">年化收益</p><p className="text-xl font-bold">{results.annualizedReturn}%</p></div>
            <div className="bg-white p-4 rounded-xl shadow-sm border"><p className="text-sm text-zinc-500">夏普比率</p><p className="text-xl font-bold">{results.sharpeRatio}</p></div>
            <div className="bg-white p-4 rounded-xl shadow-sm border"><p className="text-sm text-zinc-500">最大回撤</p><p className="text-xl font-bold">{results.maxDrawdown}%</p></div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border">
            <h3 className="font-semibold text-lg mb-4">资金曲线</h3>
            <StockChart data={results.equityCurve} dataKey="value" dateKey="date" />
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border">
            <h3 className="font-semibold text-lg mb-4">交易统计与记录</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div><p className="text-sm text-zinc-500">总交易数</p><p className="text-lg font-bold">{results.totalTrades}</p></div>
              <div><p className="text-sm text-zinc-500">胜率</p><p className="text-lg font-bold">{results.winRate}%</p></div>
              <div><p className="text-sm text-zinc-500">盈利交易数</p><p className="text-lg font-bold">{results.profitableTrades}</p></div>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="text-zinc-500 border-b"><tr><th className="p-2">买入日期</th><th className="p-2">卖出日期</th><th className="p-2">买入价</th><th className="p-2">卖出价</th><th className="p-2">盈亏</th></tr></thead>
              <tbody>
                {results && results.trades && results.trades.filter((t: any) => t.action === 'SELL').map((t: any, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="p-2">{t.buyDate}</td>
                    <td className="p-2">{t.date}</td>
                    <td className="p-2">{t.buyPrice ? t.buyPrice.toFixed(2) : 'N/A'}</td>
                    <td className="p-2">{t.price ? t.price.toFixed(2) : 'N/A'}</td>
                    <td className={`p-2 font-bold ${Number(t.profit) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {t.profit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
