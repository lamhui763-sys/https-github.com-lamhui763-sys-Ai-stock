import { useState, useEffect } from 'react';
import { Search, TrendingUp, BrainCircuit, BarChart3, History, Briefcase, Newspaper, Menu, X } from 'lucide-react';
import { motion } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
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
  const [newsWithSentiment, setNewsWithSentiment] = useState<any[]>([]);
  const [rawNews, setRawNews] = useState<any[]>([]);
  const [retailReport, setRetailReport] = useState<any>(null);
  const [qaInput, setQaInput] = useState('');
  const [qaResponse, setQaResponse] = useState('');
  const [qaLoading, setQaLoading] = useState(false);

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
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

      // 1. Fetch stock data
      const analysisResponse = await fetch(`/api/analyze/${encodeURIComponent(symbol)}?period=${period}`);
      if (!analysisResponse.ok) throw new Error('Failed to fetch stock data');
      const data = await analysisResponse.json();

      setPrice(data.last_price);
      setHistory(data.history || []);
      setFundamentalData(data.fundamental_data);
      if (socket) {
        socket.emit('subscribe', symbol);
      }

      // 2. Use Google Search Grounding to get high-quality news
      const newsQuery = `${symbol} 近两日的重要新闻，包含股份回购、业务动态、AI布局、大宗交易等`;
      
      let newsResponse;
      try {
        newsResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: newsQuery,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });
      } catch (searchError) {
        console.error("News search failed:", searchError);
        newsResponse = { text: "新闻搜索服务暂时不可用，无法获取最新新闻。" };
      }

      // 3. Analyze sentiment and structure the output
      const analysisPrompt = `
        基于以下新闻内容，对 ${symbol} 进行分析。
        请同时输出两部分内容，以JSON格式：
        1. "sentimentAnalysis": 对新闻的情绪分析数组。
        2. "newsList": 新闻列表数组，包含 title (标题), date (发布日期/时间) 和 url (新闻链接)。

        ${newsResponse.text}
        
        输出格式要求：
        {
          "sentimentAnalysis": [
            {
              "title": "新闻标题",
              "sentiment": "positive" | "negative" | "neutral",
              "futureDirection": "公司未来的发展方向 (请根据腾讯业务背景合理推断)",
              "impactPros": "该方向带来的好处 (请根据腾讯业务背景合理推断)",
              "impactCons": "该方向带来的坏处 (请根据腾讯业务背景合理推断)",
              "publicOpinion": "大众对该方向的看法 (请根据腾讯业务背景合理推断)"
            }
          ],
          "newsList": [
            {
              "title": "新闻标题",
              "date": "发布日期",
              "url": "新闻链接 (如果新闻中没有，请提供相关搜索结果的链接)"
            }
          ]
        }
      `;

      const sentimentResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: analysisPrompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const parsedResponse = JSON.parse(sentimentResponse.text || '{"sentimentAnalysis": [], "newsList": []}');
      setNewsWithSentiment(parsedResponse.sentimentAnalysis || []);
      setRawNews(parsedResponse.newsList || []);

      // 4. Generate Unified Retail Investor Report
      const reportPrompt = `Analyze ${symbol} based on the following data:
      Last Price: ${data.last_price}
      Fundamental Data: ${JSON.stringify(data.fundamental_data)}
      Technical Data: ${JSON.stringify(data.technical_data)}
      News: ${newsResponse.text}

      CRITICAL: You MUST identify the company name associated with the symbol ${symbol} from the provided data.
      If the data does not clearly identify the company, use the symbol ${symbol} as the company name.
      Generate a professional, comprehensive, yet simple unified report for retail investors in Traditional Chinese (繁體中文).
      The tone should be friendly, like a friend explaining the stock, avoiding jargon, and using "white-paper" style.
      
      Include:
      1. Executive Summary (一分鐘看懂成績單)
      2. Comprehensive Analysis (Technical & Fundamental) (綜合技術與基本面分析)
         - IMPORTANT: In this section, you MUST analyze and report any signals from RSI, MACD, Bollinger Bands, and Moving Averages (MA). If there are any buy/sell/trend signals, explicitly state them.
      3. Key Metrics Table (關鍵數據表現)
      4. SWOT Analysis (好消息與風險提示)
      5. Investment Advice (投資建議)
      6. Investment Strategy (投資策略 - 短/中/長期買賣、止盈、止損)
      7. Conclusion (總結)

      Output ONLY in JSON format following this schema:
      {
        "companyName": "...",
        "executiveSummary": "...",
        "comprehensiveAnalysis": "...",
        "keyMetrics": [{"label": "...", "value": "...", "meaning": "..."}],
        "swot": {"pros": ["..."], "cons": ["..."]},
        "investmentAdvice": {"suitableFor": "...", "notSuitableFor": "...", "tips": ["..."], "monitoringPoints": ["..."]},
        "investmentStrategy": {"short": "...", "medium": "...", "long": "...", "takeProfit": "...", "stopLoss": "..."},
        "conclusion": "..."
      }
      `;

      const reportResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: reportPrompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      setRetailReport(JSON.parse(reportResponse.text || '{}'));
      setAnalysis(''); // Clear old analysis as it's now merged
      
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

  const handleQA = async () => {
    if (!qaInput.trim() || !retailReport) return;
    setQaLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const prompt = `
        基於以下分析報告，請回答用戶的問題：${qaInput}
        
        投資建議必須包含：
        1. 短期、中期、長期買入/賣出策略。
        2. 止盈 (Take-profit) 水平。
        3. 止損 (Stop-loss) 水平。
        
        請務必使用繁體中文回答。
        
        報告內容：${JSON.stringify(retailReport)}
      `;
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      setQaResponse(response.text || '無法獲取回答。');
    } catch (error) {
      console.error(error);
      setQaResponse('處理您的問題時發生錯誤。');
    }
    setQaLoading(false);
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

        <div className="mt-8 space-y-8">
          {price !== null && (
            <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
              <h3 className="text-lg font-semibold mb-2">实时价格: {price.toFixed(2)}</h3>
              <StockChart data={history} />
            </div>
          )}

          {fundamentalData && (
            <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
              <h3 className="text-lg font-semibold mb-4">基本面分析</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-zinc-500">市盈率 (P/E)</p>
                  <p className="font-medium">{fundamentalData.summaryDetail?.trailingPE ? fundamentalData.summaryDetail.trailingPE.toFixed(2) : '暂无数据'}</p>
                </div>
                <div>
                  <p className="text-sm text-zinc-500">每股收益 (EPS)</p>
                  <p className="font-medium">{fundamentalData.defaultKeyStatistics?.trailingEps ? fundamentalData.defaultKeyStatistics.trailingEps.toFixed(2) : '暂无数据'}</p>
                </div>
                <div>
                  <p className="text-sm text-zinc-500">市值 (Market Cap)</p>
                  <p className="font-medium">{fundamentalData.summaryDetail?.marketCap ? (fundamentalData.summaryDetail.marketCap / 1e9).toFixed(2) + ' B' : '暂无数据'}</p>
                </div>
                <div>
                  <p className="text-sm text-zinc-500">股息率 (Dividend Yield)</p>
                  <p className="font-medium">{fundamentalData.summaryDetail?.dividendYield ? (fundamentalData.summaryDetail.dividendYield * 100).toFixed(2) + '%' : '暂无数据'}</p>
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
            {newsWithSentiment.length > 0 && (
              <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
                <h3 className="text-lg font-semibold mb-4">新闻情绪分析</h3>
                <div className="space-y-4">
                  {newsWithSentiment.map((news: any, i: number) => (
                    <div key={i} className="p-4 bg-zinc-50 rounded-lg border border-zinc-100">
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-sm font-medium text-zinc-900">{news.title}</p>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${news.sentiment === 'positive' ? 'bg-emerald-100 text-emerald-700' : news.sentiment === 'negative' ? 'bg-red-100 text-red-700' : 'bg-zinc-200 text-zinc-700'}`}>
                          {news.sentiment === 'positive' ? '正面' : news.sentiment === 'negative' ? '负面' : '中性'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-600 mb-1"><strong>未来方向:</strong> {news.futureDirection || 'N/A'}</p>
                      <p className="text-xs text-zinc-600 mb-1"><strong>好处:</strong> {news.impactPros || 'N/A'}</p>
                      <p className="text-xs text-zinc-600 mb-1"><strong>坏处:</strong> {news.impactCons || 'N/A'}</p>
                      <p className="text-xs text-zinc-600"><strong>大众看法:</strong> {news.publicOpinion || 'N/A'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Full News List Section */}
            {rawNews.length > 0 && (
              <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
                <h3 className="text-lg font-semibold mb-4">最新新闻列表</h3>
                <div className="space-y-2">
                  {rawNews.map((news: any, i: number) => (
                    <div key={i} className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 flex justify-between items-center">
                      <a 
                        href={news.url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-sm text-zinc-700 hover:text-emerald-600 hover:underline"
                      >
                        {news.title}
                      </a>
                      <p className="text-xs text-zinc-400 whitespace-nowrap ml-4">
                        {news.date || 'N/A'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        {retailReport && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="mt-8 bg-white p-6 rounded-2xl shadow-sm border border-zinc-200 space-y-6"
          >
            <h2 className="text-2xl font-bold text-zinc-900">{retailReport.companyName || symbol} 简易专业分析报告</h2>
            
            <section>
              <h3 className="text-lg font-semibold mb-2">1. 一分钟看懂成绩单（执行摘要）</h3>
              <p className="text-zinc-700">{retailReport.executiveSummary}</p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">2. 综合技术与基本面分析</h3>
              <p className="text-zinc-700 whitespace-pre-wrap">{retailReport.comprehensiveAnalysis}</p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">3. 关键数据表现</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-zinc-700 uppercase bg-zinc-50">
                    <tr>
                      <th className="px-4 py-2">指标</th>
                      <th className="px-4 py-2">成绩</th>
                      <th className="px-4 py-2">意义</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Fundamental Data Integration */}
                    {fundamentalData && (
                      <>
                        <tr className="bg-white border-b">
                          <td className="px-4 py-2 font-medium">市盈率 (P/E)</td>
                          <td className="px-4 py-2">{fundamentalData.summaryDetail?.trailingPE ? fundamentalData.summaryDetail.trailingPE.toFixed(2) : '暂无数据'}</td>
                          <td className="px-4 py-2">衡量股价是否合理</td>
                        </tr>
                        <tr className="bg-white border-b">
                          <td className="px-4 py-2 font-medium">每股收益 (EPS)</td>
                          <td className="px-4 py-2">{fundamentalData.defaultKeyStatistics?.trailingEps ? fundamentalData.defaultKeyStatistics.trailingEps.toFixed(2) : '暂无数据'}</td>
                          <td className="px-4 py-2">每股盈利能力</td>
                        </tr>
                        <tr className="bg-white border-b">
                          <td className="px-4 py-2 font-medium">市值</td>
                          <td className="px-4 py-2">{fundamentalData.summaryDetail?.marketCap ? (fundamentalData.summaryDetail.marketCap / 1e9).toFixed(2) + ' B' : '暂无数据'}</td>
                          <td className="px-4 py-2">公司总规模</td>
                        </tr>
                        <tr className="bg-white border-b">
                          <td className="px-4 py-2 font-medium">股息率</td>
                          <td className="px-4 py-2">{fundamentalData.summaryDetail?.dividendYield ? (fundamentalData.summaryDetail.dividendYield * 100).toFixed(2) + '%' : '暂无数据'}</td>
                          <td className="px-4 py-2">分红回报率</td>
                        </tr>
                      </>
                    )}
                    {/* Report Specific Metrics */}
                    {retailReport.keyMetrics?.map((m: any, i: number) => (
                      <tr key={i} className="bg-white border-b">
                        <td className="px-4 py-2 font-medium">{m.label}</td>
                        <td className="px-4 py-2">{m.value}</td>
                        <td className="px-4 py-2">{m.meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-lg font-semibold mb-2 text-emerald-700">好消息</h3>
                <ul className="list-disc list-inside text-sm text-zinc-700 space-y-1">
                  {retailReport.swot?.pros?.map((p: string, i: number) => <li key={i}>{p}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2 text-red-700">风险提示</h3>
                <ul className="list-disc list-inside text-sm text-zinc-700 space-y-1">
                  {retailReport.swot?.cons?.map((c: string, i: number) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">5. 投资建议</h3>
              <div className="text-sm text-zinc-700 space-y-2">
                <p><strong>适合谁：</strong> {retailReport.investmentAdvice?.suitableFor}</p>
                <p><strong>不适合谁：</strong> {retailReport.investmentAdvice?.notSuitableFor}</p>
                <p><strong>操作建议：</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  {retailReport.investmentAdvice?.tips?.map((t: string, i: number) => <li key={i}>{t}</li>)}
                </ul>
                <p><strong>监控重点：</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  {retailReport.investmentAdvice?.monitoringPoints?.map((p: string, i: number) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">6. 投資策略 (短/中/長期買賣、止盈、止損)</h3>
              <div className="text-sm text-zinc-700 space-y-2">
                <p><strong>短期策略：</strong> {retailReport.investmentStrategy?.short}</p>
                <p><strong>中期策略：</strong> {retailReport.investmentStrategy?.medium}</p>
                <p><strong>長期策略：</strong> {retailReport.investmentStrategy?.long}</p>
                <p><strong>止盈水平：</strong> {retailReport.investmentStrategy?.takeProfit}</p>
                <p><strong>止損水平：</strong> {retailReport.investmentStrategy?.stopLoss}</p>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">总结</h3>
              <p className="text-zinc-700 font-medium">{retailReport.conclusion}</p>
            </section>

            {/* AI Q&A Section */}
            <section className="mt-8 pt-6 border-t border-zinc-200">
              <h3 className="text-lg font-semibold mb-4">AI 智能问答</h3>
              <div className="space-y-4">
                <input
                  type="text"
                  value={qaInput}
                  onChange={(e) => setQaInput(e.target.value)}
                  placeholder="针对此报告提问..."
                  className="w-full p-3 border border-zinc-300 rounded-xl"
                />
                <button 
                  onClick={handleQA} 
                  disabled={qaLoading} 
                  className="w-full bg-emerald-500 text-white p-3 rounded-xl font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                >
                  {qaLoading ? '思考中...' : '提问'}
                </button>
                {qaResponse && (
                  <div className="p-4 bg-zinc-100 rounded-xl whitespace-pre-wrap text-zinc-700 text-sm">
                    {qaResponse}
                  </div>
                )}
              </div>
            </section>
          </motion.div>
        )}

        {analysis && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="mt-8 bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200"
          >
            <h3 className="text-lg font-semibold mb-2">综合技术与基本面分析</h3>
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
