import { useState, useEffect } from 'react';
import { Plus, Trash2, TrendingUp, TrendingDown } from 'lucide-react';

interface Stock {
  id: string;
  symbol: string;
  purchasePrice: number;
  purchaseDate: string;
  shares: number;
}

export default function Portfolio() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [symbol, setSymbol] = useState('');
  const [price, setPrice] = useState('');
  const [shares, setShares] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('portfolio');
    if (saved) setStocks(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('portfolio', JSON.stringify(stocks));
  }, [stocks]);

  const addStock = () => {
    if (!symbol || !price || !shares) return;
    const newStock: Stock = {
      id: Date.now().toString(),
      symbol,
      purchasePrice: parseFloat(price),
      purchaseDate: new Date().toISOString().split('T')[0],
      shares: parseFloat(shares),
    };
    setStocks([...stocks, newStock]);
    setSymbol('');
    setPrice('');
    setShares('');
  };

  const deleteStock = (id: string) => {
    setStocks(stocks.filter(s => s.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
        <h3 className="text-lg font-semibold mb-4">新增持仓</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input placeholder="股票代码" value={symbol} onChange={e => setSymbol(e.target.value)} className="p-3 border border-zinc-300 rounded-xl" />
          <input placeholder="买入价格" type="number" value={price} onChange={e => setPrice(e.target.value)} className="p-3 border border-zinc-300 rounded-xl" />
          <input placeholder="股数" type="number" value={shares} onChange={e => setShares(e.target.value)} className="p-3 border border-zinc-300 rounded-xl" />
        </div>
        <button onClick={addStock} className="mt-4 w-full bg-emerald-500 text-white p-3 rounded-xl font-medium hover:bg-emerald-600 flex items-center justify-center gap-2">
          <Plus size={18} /> 添加至组合
        </button>
      </div>

      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
        <h3 className="text-lg font-semibold mb-4">我的投资组合</h3>
        <div className="space-y-4">
          {stocks.map(stock => (
            <div key={stock.id} className="flex items-center justify-between p-4 bg-zinc-50 rounded-xl border border-zinc-100">
              <div>
                <p className="font-bold text-zinc-900">{stock.symbol}</p>
                <p className="text-sm text-zinc-500">{stock.shares} 股 @ {stock.purchasePrice}</p>
              </div>
              <button onClick={() => deleteStock(stock.id)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg">
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
