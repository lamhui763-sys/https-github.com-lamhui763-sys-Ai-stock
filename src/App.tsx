import { useState, useEffect } from 'react';
import { Search, TrendingUp, BrainCircuit, BarChart3, History, Briefcase, Newspaper, Menu, X } from 'lucide-react';
import { motion } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import io from 'socket.io-client';
import Portfolio from './components/Portfolio';
import StockChart from './components/StockChart';
import BacktestEngine from './components/BacktestEngine';

const FEATURES = [
  { id: 'stock', name: '股票分析', icon: TrendingUp },
  { id: 'chat', name: 'AI 对话', icon: BrainCircuit },
  { id: 'backtest', name: '回测引擎', icon: History },
  { id: 'portfolio', name: '投资组合', icon: Briefcase },
];

export default function App() {
  const [selectedFeature, setSelectedFeature] = useState(FEATURES[0].id);
  const [symbol, setSymbol] = useState('^HSI');
  const [period, setPeriod] = useState('6mo');
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [socket, setSocket] = useState<any>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [fundamentalData, setFundamentalData] = useState<any>(null);

  // AI Chat states
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSession, setChatSession] = useState<any>(null);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    setChatSession(ai.chats.create({
      model: "gemini-3-flash-preview",
      config: { systemInstruction: "You are a helpful stock analysis assistant." },
    }));
    return () => newSocket.close();
  }, []);

  useEffect(() => {
    if (socket) {
      socket.on('priceUpdate', (data: any) => {
        if (data.symbol === symbol) {
          setPrice(data.price);
        }
      });
    }
  }, [socket, symbol]);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const [analysisResponse, newsResponse] = await Promise.all([
        fetch(`/api/analyze/${encodeURIComponent(symbol)}?period=${period}`),
        fetch(`/api/news/${encodeURIComponent(symbol)}`)
      ]);
      
      if (!analysisResponse.ok || !newsResponse.ok) {
        throw new Error('Failed to fetch data');
      }
      
      const data = await analysisResponse.json();
      const newsData = await newsResponse.json();
      
      if (data.error) {
        setAnalysis(data.error);
        setLoading(false);
        return;
      }

      setPrice(data.last_price);
      setHistory(data.history);
      setFundamentalData(data.fundamental_data);
      if (socket) {
        socket.emit('subscribe', symbol);
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const prompt = `Analyze the following stock data and news for ${symbol}:
      Last Price: ${data.last_price}
      SMA 20: ${data.sma_20}
      Recent Technical Data: ${JSON.stringify(data.technical_data)}
      Fundamental Data: ${JSON.stringify(data.fundamental_data)}
      News: ${JSON.stringify(newsData.slice(0, 5))}
      
      For each news item, determine if the sentiment is positive, negative, or neutral regarding the stock.
      Provide a comprehensive summary of the AI's findings, including technical and fundamental analysis, news impact (with sentiment for each item), short-term price movement prediction, and potential investment opportunities.
      Please provide your response in Chinese (中文).`;

      const aiResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setAnalysis(aiResponse.text || '分析完成');
      
    } catch (error) {
      console.error(error);
      setAnalysis('Error calling backend or AI analysis: ' + (error instanceof Error ? error.message : String(error)));
    }
    setLoading(false);
  };

  const handleChat = async () => {
    if (!chatInput.trim() || !chatSession) return;
    setLoading(true);
    setChatMessages(prev => [...prev, { role: 'user', text: chatInput }]);
    const input = chatInput;
    setChatInput('');
    try {
      const response = await chatSession.sendMessage({ message: input });
      setChatMessages(prev => [...prev, { role: 'model', text: response.text || '' }]);
    } catch (error) {
      console.error(error);
      setChatMessages(prev => [...prev, { role: 'model', text: 'Error: ' + (error instanceof Error ? error.message : String(error)) }]);
    }
    setLoading(false);
  };

  const renderContent = () => {
    if (selectedFeature === 'portfolio') {
      return <Portfolio />;
    }
    if (selectedFeature === 'backtest') {
      return <BacktestEngine />;
    }
    if (selectedFeature === 'chat') {
      return (
        <div className="max-w-2xl mx-auto h-[calc(100vh-100px)] flex flex-col">
          <h2 className="text-2xl font-bold text-zinc-900 mb-6">AI 对话</h2>
          <div className="flex-1 overflow-y-auto space-y-4 mb-4">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`p-4 rounded-xl ${msg.role === 'user' ? 'bg-emerald-100 ml-auto' : 'bg-zinc-100'}`}>
                {msg.text}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="输入您的问题..."
              className="flex-1 p-3 border border-zinc-300 rounded-xl"
            />
            <button 
              onClick={handleChat} 
              disabled={loading} 
              className="bg-emerald-500 text-white p-3 rounded-xl font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-zinc-900 mb-6">股票配置</h2>
        
        <div className="space-y-6 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">股票代码</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full p-3 border border-zinc-300 rounded-xl"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">时间周期</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full p-3 border border-zinc-300 rounded-xl bg-white"
            >
              <option value="1mo">1mo</option>
              <option value="3mo">3mo</option>
              <option value="6mo">6mo</option>
              <option value="1y">1y</option>
            </select>
          </div>

          <button 
            onClick={handleSearch} 
            disabled={loading} 
            className="w-full bg-emerald-500 text-white p-3 rounded-xl font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            {loading ? '分析中...' : '开始分析'}
          </button>
        </div>

        {price !== null && (
          <div className="mt-8 space-y-8">
            <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
              <h3 className="text-lg font-semibold mb-2">实时价格: {price.toFixed(2)}</h3>
              <StockChart data={history} />
            </div>

            {fundamentalData && (
              <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
                <h3 className="text-lg font-semibold mb-4">基本面分析</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-zinc-500">市盈率 (P/E)</p>
                    <p className="font-medium">{fundamentalData.summaryDetail?.trailingPE?.toFixed(2) || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-zinc-500">每股收益 (EPS)</p>
                    <p className="font-medium">{fundamentalData.defaultKeyStatistics?.trailingEps?.toFixed(2) || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-zinc-500">市值 (Market Cap)</p>
                    <p className="font-medium">{(fundamentalData.summaryDetail?.marketCap / 1e9).toFixed(2)} B</p>
                  </div>
                  <div>
                    <p className="text-sm text-zinc-500">股息率 (Dividend Yield)</p>
                    <p className="font-medium">{(fundamentalData.summaryDetail?.dividendYield * 100 || 0).toFixed(2)}%</p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-sm text-zinc-500">财务健康总结</p>
                  <p className="text-sm text-zinc-700 mt-1">
                    {fundamentalData.financialData?.recommendationKey || '暂无数据'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {analysis && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="mt-8 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200"
          >
            <h3 className="text-lg font-semibold mb-2">分析结果</h3>
            <p className="text-zinc-700 whitespace-pre-wrap">{analysis}</p>
          </motion.div>
        )}
      </div>
    );
  };


  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col md:flex-row font-sans">
      {/* Mobile Header */}
      <header className="md:hidden bg-white border-b border-zinc-200 p-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
          <TrendingUp className="text-emerald-500" />
          AI投资分析
        </h1>
        <button onClick={() => setIsMenuOpen(!isMenuOpen)}>
          {isMenuOpen ? <X /> : <Menu />}
        </button>
      </header>

      {/* Sidebar / Mobile Menu */}
      <aside className={`${isMenuOpen ? 'block' : 'hidden'} md:block w-full md:w-64 bg-white border-r border-zinc-200 p-6`}>
        <h1 className="hidden md:flex text-xl font-bold text-zinc-900 mb-8 items-center gap-2">
          <TrendingUp className="text-emerald-500" />
          AI投资分析工具
        </h1>
        
        <nav className="space-y-2">
          <p className="text-sm text-zinc-500 mb-2">选择功能</p>
          {FEATURES.map((feature) => (
            <button
              key={feature.id}
              onClick={() => {
                setSelectedFeature(feature.id);
                setIsMenuOpen(false);
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg text-sm transition-colors ${
                selectedFeature === feature.id 
                  ? 'bg-emerald-50 text-emerald-700 font-medium' 
                  : 'text-zinc-600 hover:bg-zinc-100'
              }`}
            >
              <feature.icon size={18} />
              {feature.name}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8">
        {renderContent()}
      </main>
    </div>
  );
}
