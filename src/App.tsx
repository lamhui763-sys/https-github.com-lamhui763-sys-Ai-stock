import { useState, useEffect } from 'react';
import { Search, TrendingUp, BrainCircuit, BarChart3, History, Briefcase, Newspaper, Menu, X, Info } from 'lucide-react';
import { motion } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import io from 'socket.io-client';
import { Toaster, toast } from 'sonner';
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
  const [alerts, setAlerts] = useState<{symbol: string, targetPrice: number, type: 'above' | 'below'}[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [fundamentalData, setFundamentalData] = useState<any>(null);
  const [newsWithSentiment, setNewsWithSentiment] = useState<any[]>([]);
  const [rawNews, setRawNews] = useState<any[]>([]);
  const [realTimeNews, setRealTimeNews] = useState<any[]>([]);

  const getRedFlags = (data: any) => {
    const flags = [];
    const financialData = data.financialData;
    const keyStats = data.defaultKeyStatistics;
    const summary = data.summaryDetail;

    if (financialData?.debtToEquity > 200) {
      flags.push({ type: 'danger', message: '高槓桿風險：負債權益比 > 200%' });
    }
    if (financialData?.returnOnEquity < 0.10) {
      flags.push({ type: 'warning', message: '獲利能力偏低：ROE < 10%' });
    }
    if (summary?.trailingPE > 50) {
      flags.push({ type: 'warning', message: '估值過高：P/E > 50' });
    }
    if (financialData?.currentRatio < 1) {
      flags.push({ type: 'danger', message: '流動性風險：流動比率 < 1' });
    }
    return flags;
  };

  const formatPercent = (val: any) => val ? (val * 100).toFixed(2) + '%' : 'N/A';
  const formatNum = (val: any) => val ? val.toLocaleString() : 'N/A';
  const formatCompact = (val: any) => val ? (val / 1e9).toFixed(2) + 'B' : 'N/A';

  const safeJsonParse = (str: string, fallback: any = {}) => {
    try {
      let cleanStr = str.trim();
      // Clean up the string: remove markdown code blocks if present
      cleanStr = cleanStr.replace(/^```json\s*/, '').replace(/```$/, '').trim();
      
      // Find the first '{' or '[' to start parsing
      const firstBrace = cleanStr.indexOf('{');
      const firstBracket = cleanStr.indexOf('[');
      
      let startIndex = -1;
      if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        startIndex = firstBrace;
      } else if (firstBracket !== -1) {
        startIndex = firstBracket;
      }
      
      if (startIndex === -1) return fallback;
      
      // Find the matching end brace/bracket by tracking nesting and ignoring strings
      let openChar = cleanStr[startIndex];
      let closeChar = openChar === '{' ? '}' : ']';
      let count = 0;
      let inString = false;
      let escaped = false;
      let endIndex = -1;
      
      for (let i = startIndex; i < cleanStr.length; i++) {
        const char = cleanStr[i];
        
        if (escaped) {
          escaped = false;
          continue;
        }
        
        if (char === '\\') {
          escaped = true;
          continue;
        }
        
        if (char === '"') {
          inString = !inString;
          continue;
        }
        
        if (!inString) {
          if (char === openChar) count++;
          else if (char === closeChar) count--;
          
          if (count === 0) {
            endIndex = i;
            break;
          }
        }
      }
      
      if (endIndex !== -1) {
        cleanStr = cleanStr.substring(startIndex, endIndex + 1);
      }
      
      return JSON.parse(cleanStr);
    } catch (e) {
      console.error("Failed to parse JSON:", e, "Original string:", str);
      // Last resort: try simple substring if robust parsing failed
      try {
        const s = str.trim().replace(/^```json\s*/, '').replace(/```$/, '').trim();
        const first = Math.min(s.indexOf('{') === -1 ? Infinity : s.indexOf('{'), s.indexOf('[') === -1 ? Infinity : s.indexOf('['));
        const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
        if (first !== Infinity && last !== -1 && last > first) {
          return JSON.parse(s.substring(first, last + 1));
        }
      } catch (e2) {}
      return fallback;
    }
  };

  const getPEInterpretation = (pe: number) => {
    if (!pe) return null;
    if (pe < 15) return { text: '估值較低 (便宜)', color: 'text-emerald-600' };
    if (pe <= 30) return { text: '估值中等 (合理)', color: 'text-amber-600' };
    return { text: '估值較高 (昂貴)', color: 'text-red-600' };
  };

  const getROEInterpretation = (roe: number) => {
    if (!roe) return null;
    if (roe >= 0.15) return { text: '獲利優秀', color: 'text-emerald-600' };
    if (roe >= 0.10) return { text: '獲利尚可', color: 'text-amber-600' };
    return { text: '獲利偏弱', color: 'text-red-600' };
  };

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case '十分優秀': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
      case '優秀': return 'text-green-600 bg-green-50 border-green-100';
      case '良好': return 'text-teal-600 bg-teal-50 border-teal-100';
      case '合理': return 'text-blue-600 bg-blue-50 border-blue-100';
      case '一般': return 'text-zinc-600 bg-zinc-50 border-zinc-100';
      case '較差': return 'text-orange-600 bg-orange-50 border-orange-100';
      case '十分差': return 'text-red-600 bg-red-50 border-red-100';
      default: return 'text-zinc-500 bg-zinc-50 border-zinc-100';
    }
  };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case '高': return 'text-red-600 bg-red-50 border-red-100';
      case '中': return 'text-orange-600 bg-orange-50 border-orange-100';
      case '低': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
      default: return 'text-zinc-500 bg-zinc-50 border-zinc-100';
    }
  };

  const MetricCard = ({ title, value, interpretation, explanation }: { title: string, value: string | number, interpretation?: { text: string, color: string } | null, explanation: string }) => (
    <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 group relative">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-zinc-500">{title}</p>
        <div className="relative">
          <Info className="w-3 h-3 text-zinc-300 cursor-help hover:text-zinc-500 transition-colors" />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-zinc-900 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-20">
            {explanation}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-zinc-900"></div>
          </div>
        </div>
      </div>
      <p className="text-lg font-bold text-zinc-900">{value}</p>
      {interpretation && (
        <p className={`text-[10px] font-bold mt-1 ${interpretation.color}`}>
          {interpretation.text}
        </p>
      )}
    </div>
  );

  const [retailReport, setRetailReport] = useState<any>(null);
  const [qaInput, setQaInput] = useState('');
  const [qaResponse, setQaResponse] = useState('');
  const [qaLoading, setQaLoading] = useState(false);

  // AI Chat states
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSession, setChatSession] = useState<any>(null);

  useEffect(() => {
    const newSocket = io({
      transports: ['websocket'],
      withCredentials: true,
      reconnectionAttempts: 10,
      timeout: 30000
    });
    setSocket(newSocket);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is missing!");
      toast.error("GEMINI_API_KEY is missing! Please check your environment variables.");
      return () => newSocket.close();
    }
    const ai = new GoogleGenAI({ apiKey });
    setChatSession(ai.chats.create({
      model: "gemini-3-flash-preview",
      config: { systemInstruction: "你是一個專業的股票分析助手。當用戶詢問財務指標（如市盈率 P/E、ROE 等）時，請務必用淺顯易懂的語言解釋其含義，並說明該數字在當前行業背景下是否合理。對於小白用戶，請多用比喻（例如 P/E 是回本年期）。" },
    }));
    return () => newSocket.close();
  }, []);

  useEffect(() => {
    if (socket) {
      socket.on('connect', () => console.log('Socket connected'));
      socket.on('connect_error', (err: any) => console.error('Socket connection error:', err));
      socket.on('priceUpdate', (data: any) => {
        if (data.symbol === symbol) {
          setPrice(data.price);
        }
        // Check alerts
        alerts.forEach(alert => {
          if (alert.symbol === data.symbol) {
            if (alert.type === 'above' && data.price >= alert.targetPrice) {
              toast.success(`Alert: ${data.symbol} reached ${data.price.toFixed(2)} (Target: ${alert.targetPrice})`);
            } else if (alert.type === 'below' && data.price <= alert.targetPrice) {
              toast.error(`Alert: ${data.symbol} dropped to ${data.price.toFixed(2)} (Target: ${alert.targetPrice})`);
            }
          }
        });
      });
    }
  }, [socket, symbol, alerts]);

  const analyzeNewsSentiment = async (newsItems: any[], stockSymbol: string) => {
    if (newsItems.length === 0) return [];
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return [];
    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `
      分析以下關於股票 ${stockSymbol} 的新聞情緒。
      對於每一項，請提供：
      1. title: 原始標題。
      2. sentiment: "positive", "negative", 或 "neutral"。
      3. summary: 一句非常簡短的繁體中文摘要。
      
      新聞列表：
      ${newsItems.map((item, i) => `${i+1}. ${item.title}`).join('\n')}
      
      請以 JSON 格式輸出：
      {
        "analysis": [
          { "title": "...", "sentiment": "...", "summary": "..." },
          ...
        ]
      }
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      const parsed = safeJsonParse(response.text || '', { analysis: [] });
      return parsed.analysis;
    } catch (error) {
      console.error("Sentiment analysis failed:", error);
      return newsItems.map(item => ({ title: item.title, sentiment: 'neutral', summary: '無法分析情緒' }));
    }
  };

  const handleSearch = async () => {
    setLoading(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is missing');
      const ai = new GoogleGenAI({ apiKey });

      // 1. Fetch stock data
      console.log(`Fetching stock data for ${symbol}...`);
      const analysisResponse = await fetch(`/api/analyze/${encodeURIComponent(symbol)}?period=${period}`);
      if (!analysisResponse.ok) {
        const errorData = await analysisResponse.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `Failed to fetch stock data: ${analysisResponse.status}`);
      }
      const data = await analysisResponse.json();
      console.log('Stock data received:', data);

      setPrice(data.last_price);
      setHistory(data.history || []);
      setFundamentalData(data.fundamental_data);
      if (socket) {
        socket.emit('subscribe', symbol);
      }

      // 2. Fetch real-time news from API and analyze sentiment
      console.log(`Fetching real-time news for ${symbol}...`);
      const newsApiUrl = `/api/news/${encodeURIComponent(symbol)}`;
      const newsApiResponse = await fetch(newsApiUrl);
      if (newsApiResponse.ok) {
        const newsData = await newsApiResponse.json();
        const analyzedNews = await analyzeNewsSentiment(newsData.slice(0, 5), symbol);
        setRealTimeNews(analyzedNews);
      }

      // 3. Use Google Search Grounding to get high-quality news
      const newsQuery = `${symbol} 近两日的重要新闻，包含股份回购、业务动态、AI布局、大宗交易等`;
      
      let newsResponse;
      let retries = 3;
      while (retries > 0) {
        try {
          newsResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: newsQuery,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });
          break; // Success
        } catch (searchError) {
          console.error(`News search attempt failed (${retries} left):`, searchError);
          retries--;
          if (retries === 0) {
            newsResponse = { text: "新闻搜索服务暂时不可用，无法获取最新新闻。请稍后再试。" };
          } else {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
          }
        }
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
              "publicOpinion": "大众对该方向的看法 (请根據騰訊業務背景合理推斷)"
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

      const parsedResponse = safeJsonParse(sentimentResponse.text || '', {"sentimentAnalysis": [], "newsList": []});
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
      2. Creative Analogy (生活化比喻)
         - Use simple, everyday analogies like a 'Bakery' or an 'Athlete' to explain the stock's current situation, potential, and risks. 
         - For example, if it's Tencent, you might compare it to a leading bakery with popular products but facing some 'stomach discomfort' (security issues) that it needs to solve.
      3. Comprehensive Analysis (Technical & Fundamental) (綜合技術與基本面分析)
         - IMPORTANT: In this section, you MUST analyze and report any signals from RSI, MACD, Bollinger Bands, and Moving Averages (MA). If there are any buy/sell/trend signals, explicitly state them.
      3. Key Metrics Table (關鍵數據表現)
         - IMPORTANT: For each metric in this table, the 'meaning' field MUST be a detailed, beginner-friendly explanation. 
         - It should not just define the metric, but also provide a verdict on whether the current value is reasonable, healthy, cheap, or expensive based on the company's specific context (industry, historical average, growth).
         - Example for P/E: "目前 17.81 倍代表回本期約 18 年，在科技行業中屬於合理偏低水平，顯示股價尚未過度泡沫。"
         - NEW: For each metric, provide a 'rating' field. The value MUST be one of: "十分優秀", "優秀", "良好", "合理", "一般", "較差", "十分差".
      4. SWOT Analysis (好消息與風險提示)
         - IMPORTANT: For each risk in 'cons', provide a 'level' (低/中/高) and a 'basis' (評估依據).
      5. Investment Advice (投資建議)
      6. Investment Strategy (投資策略 - 短/中/長期買賣、止盈、止損)
         - IMPORTANT: For short, medium, and long-term strategies, provide specific buy/sell point descriptions, target price ranges, and corresponding risk warnings.
         - For take-profit and stop-loss, provide specific values or ranges based on current technical indicators (RSI, MACD, Moving Averages) and company fundamentals, and explain the reasoning.
      7. Conclusion (總結)

      Output ONLY in JSON format following this schema:
      {
        "companyName": "...",
        "executiveSummary": "...",
        "creativeAnalogy": {
          "title": "...",
          "content": "..."
        },
        "comprehensiveAnalysis": "...",
        "keyMetrics": [
          {"label": "市盈率 (P/E)", "value": "...", "meaning": "...", "rating": "..."},
          {"label": "每股收益 (EPS)", "value": "...", "meaning": "...", "rating": "..."},
          {"label": "市值", "value": "...", "meaning": "...", "rating": "..."},
          {"label": "股息率", "value": "...", "meaning": "...", "rating": "..."},
          {"label": "...", "value": "...", "meaning": "...", "rating": "..."}
        ],
        "swot": {
          "pros": ["..."],
          "cons": [
            {"risk": "...", "level": "低/中/高", "basis": "..."}
          ]
        },
        "investmentAdvice": {"suitableFor": "...", "notSuitableFor": "...", "tips": ["..."], "monitoringPoints": ["..."]},
        "investmentStrategy": {
          "shortTerm": { "action": "...", "buyPoint": "...", "sellPoint": "...", "targetRange": "...", "riskWarning": "..." },
          "mediumTerm": { "action": "...", "buyPoint": "...", "sellPoint": "...", "targetRange": "...", "riskWarning": "..." },
          "longTerm": { "action": "...", "buyPoint": "...", "sellPoint": "...", "targetRange": "...", "riskWarning": "..." },
          "takeProfit": { "value": "...", "basis": "..." },
          "stopLoss": { "value": "...", "basis": "..." }
        },
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

      setRetailReport(safeJsonParse(reportResponse.text || '', {}));
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
        <div className="max-w-4xl mx-auto h-[calc(100vh-100px)] flex flex-col gap-6">
          <div className="flex flex-col md:flex-row gap-6 flex-1 overflow-hidden">
            {/* Chat Section */}
            <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
              <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
                <h2 className="text-lg font-bold text-zinc-900">AI 智能對話</h2>
                <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded uppercase">Live</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {chatMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 space-y-2">
                    <BrainCircuit size={48} strokeWidth={1.5} />
                    <p className="text-sm">您可以詢問關於 {symbol} 的任何問題</p>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                      msg.role === 'user' 
                        ? 'bg-emerald-500 text-white rounded-tr-none' 
                        : 'bg-zinc-100 text-zinc-800 rounded-tl-none border border-zinc-200'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-zinc-100 text-zinc-400 p-3 rounded-2xl rounded-tl-none border border-zinc-200 text-sm animate-pulse">
                      思考中...
                    </div>
                  </div>
                )}
              </div>
              <div className="p-4 border-t border-zinc-100 bg-zinc-50">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                    placeholder="輸入您的問題..."
                    className="flex-1 p-3 border border-zinc-300 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                  />
                  <button 
                    onClick={handleChat} 
                    disabled={loading || !chatInput.trim()} 
                    className="bg-emerald-500 text-white p-3 rounded-xl font-medium hover:bg-emerald-600 disabled:opacity-50 transition-all shadow-sm shadow-emerald-200"
                  >
                    發送
                  </button>
                </div>
              </div>
            </div>

            {/* Real-time News Sidebar */}
            <div className="w-full md:w-80 flex flex-col bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
              <div className="p-4 border-b border-zinc-100 flex items-center gap-2">
                <Newspaper size={18} className="text-emerald-500" />
                <h3 className="text-sm font-bold text-zinc-900">實時新聞情緒</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {realTimeNews.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-center p-4">
                    <p className="text-xs italic">暫無實時新聞數據，請先搜索股票代碼。</p>
                  </div>
                ) : (
                  realTimeNews.map((news, i) => (
                    <div key={i} className="p-3 bg-zinc-50 rounded-xl border border-zinc-100 hover:border-emerald-200 transition-colors group">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <p className="text-xs font-bold text-zinc-900 leading-tight group-hover:text-emerald-700 transition-colors">{news.title}</p>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          news.sentiment === 'positive' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 
                          news.sentiment === 'negative' ? 'bg-red-100 text-red-700 border border-red-200' : 
                          'bg-zinc-200 text-zinc-600 border border-zinc-300'
                        }`}>
                          {news.sentiment === 'positive' ? '利好' : news.sentiment === 'negative' ? '利空' : '中性'}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 leading-relaxed">{news.summary}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
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
              <div className="flex gap-2 mb-4">
                <input type="number" placeholder="目标价格" id="targetPrice" className="p-2 border rounded" />
                <select id="alertType" className="p-2 border rounded">
                  <option value="above">高于</option>
                  <option value="below">低于</option>
                </select>
                <button onClick={() => {
                  const targetPrice = parseFloat((document.getElementById('targetPrice') as HTMLInputElement).value);
                  const type = (document.getElementById('alertType') as HTMLSelectElement).value as 'above' | 'below';
                  if (!isNaN(targetPrice)) {
                    setAlerts([...alerts, { symbol, targetPrice, type }]);
                    toast.info(`Alert set for ${symbol} at ${targetPrice}`);
                  }
                }} className="bg-emerald-500 text-white px-4 py-2 rounded">设置提醒</button>
              </div>
              <StockChart data={history} />
            </div>
          )}

          {fundamentalData && (
            <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-zinc-900">全面基本面深度分析</h3>
                <div className="flex gap-2">
                  <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded">專業版</span>
                </div>
              </div>

              {/* Red Flags Section */}
              {getRedFlags(fundamentalData).length > 0 && (
                <div className="mb-8 space-y-2">
                  {getRedFlags(fundamentalData).map((flag, i) => (
                    <div key={i} className={`p-3 rounded-xl flex items-center gap-3 ${flag.type === 'danger' ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
                      <span className="text-lg">{flag.type === 'danger' ? '🚩' : '⚠️'}</span>
                      <span className="text-sm font-medium">{flag.message}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-8">
                {/* 1. Profitability */}
                <section>
                  <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4">1. 獲利能力 (Profitability)</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <MetricCard 
                      title="毛利率 (Gross Margin)" 
                      value={formatPercent(fundamentalData.financialData?.grossMargins)}
                      explanation="扣除直接成本後的獲利比例。越高代表產品競爭力越強。"
                    />
                    <MetricCard 
                      title="營業利益率 (Op Margin)" 
                      value={formatPercent(fundamentalData.financialData?.operatingMargins)}
                      explanation="扣除營運費用後的獲利能力，反映核心業務健康度。"
                    />
                    <MetricCard 
                      title="淨利率 (Net Margin)" 
                      value={formatPercent(fundamentalData.financialData?.profitMargins)}
                      explanation="最終到股東手中的獲利比例。受稅率和利息影響。"
                    />
                    <MetricCard 
                      title="ROE (股東權益報酬率)" 
                      value={formatPercent(fundamentalData.financialData?.returnOnEquity)}
                      interpretation={getROEInterpretation(fundamentalData.financialData?.returnOnEquity)}
                      explanation="公司用股東的錢賺錢的效率。巴菲特建議 > 15%。"
                    />
                    <MetricCard 
                      title="ROA (資產報酬率)" 
                      value={formatPercent(fundamentalData.financialData?.returnOnAssets)}
                      explanation="每元資產創造的淨利，衡量資產運用效率。"
                    />
                  </div>
                </section>

                {/* 2. Liquidity & Solvency */}
                <section>
                  <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4">2. 償債能力 (Solvency)</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <MetricCard 
                      title="流動比率 (Current Ratio)" 
                      value={fundamentalData.financialData?.currentRatio?.toFixed(2) || 'N/A'}
                      explanation="短期資產能否覆蓋短期負債。> 1.5 較安全。"
                    />
                    <MetricCard 
                      title="負債權益比 (D/E)" 
                      value={fundamentalData.financialData?.debtToEquity?.toFixed(2) || 'N/A'}
                      explanation="總負債與股東權益的比值。越高代表槓桿越高，風險越大。"
                    />
                  </div>
                </section>

                {/* 3. Valuation */}
                <section>
                  <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-4">3. 估值指標 (Valuation)</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <MetricCard 
                      title="本益比 (P/E)" 
                      value={fundamentalData.summaryDetail?.trailingPE?.toFixed(2) || 'N/A'}
                      interpretation={getPEInterpretation(fundamentalData.summaryDetail?.trailingPE)}
                      explanation="回本年期。17.87 代表假設利潤不變，需 17.87 年回本。越低越便宜。"
                    />
                    <MetricCard 
                      title="本淨比 (P/B)" 
                      value={fundamentalData.defaultKeyStatistics?.priceToBook?.toFixed(2) || 'N/A'}
                      explanation="股價與每股淨值的比率。通常 < 1.5 代表具備安全邊際。"
                    />
                    <MetricCard 
                      title="PEG 比率" 
                      value={fundamentalData.defaultKeyStatistics?.pegRatio?.toFixed(2) || 'N/A'}
                      explanation="考慮成長性的本益比。 < 1 代表估值合理且具成長潛力。"
                    />
                    <MetricCard 
                      title="市值 (Market Cap)" 
                      value={formatCompact(fundamentalData.summaryDetail?.marketCap)}
                      explanation="公司的總價值（股價 × 總股數）。"
                    />
                    <MetricCard 
                      title="股息率 (Yield)" 
                      value={formatPercent(fundamentalData.summaryDetail?.dividendYield)}
                      explanation="公司每年派發的股息與股價的比率。類似存款利息。"
                    />
                  </div>
                </section>

                <div className="mt-8 p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <h4 className="text-sm font-bold text-emerald-800 mb-2 flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4" /> 小白科普：如何判斷數字是否合理？
                  </h4>
                  <div className="space-y-3 text-xs text-emerald-700 leading-relaxed">
                    <p>
                      <strong>1. 市盈率 (P/E) 17.87 是什麼意思？</strong><br />
                      簡單來說，這代表「回本年期」。假設公司利潤不變，你現在買入股票，需要 17.87 年才能靠利潤賺回本金。通常 15-20 倍被視為合理，但高成長股（如科技股）可能高達 50 倍，而成熟股（如銀行）可能只有 8-10 倍。
                    </p>
                    <p>
                      <strong>2. 為什麼要看 ROE？</strong><br />
                      ROE 代表公司用股東的錢賺錢的能力。如果 ROE 是 15%，代表公司每用股東 100 元，一年能賺 15 元。這是衡量公司「賺錢效率」最重要的指標。
                    </p>
                    <p>
                      <strong>3. 償債能力重要嗎？</strong><br />
                      非常重要！如果「流動比率」小於 1，代表公司手頭現金不足以支付一年內到期的債務，有破產風險。
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-zinc-100">
                  <p className="text-xs text-zinc-400 leading-relaxed italic">
                    * 數據來源：Yahoo Finance。所有指標應結合行業背景與歷史趨勢進行綜合判斷。高 ROE 伴隨高負債可能隱藏風險。
                  </p>
                </div>
              </div>
            </div>
          )}

          {newsWithSentiment.length > 0 && (
            <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
              <h3 className="text-lg font-semibold mb-4">新聞情緒分析</h3>
              <div className="space-y-4">
                {newsWithSentiment.map((news: any, i: number) => (
                  <div key={i} className="p-4 bg-zinc-50 rounded-lg border border-zinc-100">
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-sm font-medium text-zinc-900">{news.title}</p>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${news.sentiment === 'positive' ? 'bg-emerald-100 text-emerald-700' : news.sentiment === 'negative' ? 'bg-red-100 text-red-700' : 'bg-zinc-200 text-zinc-700'}`}>
                        {news.sentiment === 'positive' ? '正面' : news.sentiment === 'negative' ? '負面' : '中性'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 mb-1"><strong>未來方向:</strong> {news.futureDirection || 'N/A'}</p>
                    <p className="text-xs text-zinc-600 mb-1"><strong>好處:</strong> {news.impactPros || 'N/A'}</p>
                    <p className="text-xs text-zinc-600 mb-1"><strong>壞處:</strong> {news.impactCons || 'N/A'}</p>
                    <p className="text-xs text-zinc-600"><strong>大眾看法:</strong> {news.publicOpinion || 'N/A'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full News List Section */}
          {rawNews.length > 0 && (
            <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-zinc-200">
              <h3 className="text-lg font-semibold mb-4">最新新聞列表</h3>
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
            <h2 className="text-2xl font-bold text-zinc-900">{retailReport.companyName || symbol} 簡易專業分析報告</h2>
            
            <section>
              <h3 className="text-lg font-semibold mb-2">1. 一分鐘看懂成績單（執行摘要）</h3>
              <p className="text-zinc-700">{retailReport.executiveSummary}</p>
            </section>

            {retailReport.creativeAnalogy && (
              <section className="p-5 bg-blue-50 rounded-2xl border border-blue-100">
                <h3 className="text-lg font-bold mb-2 text-blue-900 flex items-center gap-2">
                  <span className="text-xl">💡</span> 2. 生活化比喻：{retailReport.creativeAnalogy.title}
                </h3>
                <p className="text-blue-800 leading-relaxed italic">
                  「{retailReport.creativeAnalogy.content}」
                </p>
              </section>
            )}

            <section>
              <h3 className="text-lg font-semibold mb-2">3. 綜合技術與基本面分析</h3>
              <p className="text-zinc-700 whitespace-pre-wrap">{retailReport.comprehensiveAnalysis}</p>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">4. 關鍵數據表現</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-zinc-700 uppercase bg-zinc-50">
                    <tr>
                      <th className="px-4 py-2">指標</th>
                      <th className="px-4 py-2">成績</th>
                      <th className="px-4 py-2">意義</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Report Specific Metrics */}
                    {retailReport.keyMetrics?.map((m: any, i: number) => (
                      <tr key={i} className="bg-white border-b">
                        <td className="px-4 py-4 font-medium align-top">{m.label}</td>
                        <td className="px-4 py-4 align-top">
                          <div className="font-semibold text-zinc-900 mb-1">{m.value}</div>
                          {m.rating && (
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${getRatingColor(m.rating)}`}>
                              {m.rating}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-zinc-600 leading-relaxed">{m.meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-lg font-semibold mb-2 text-emerald-700">5. 好消息</h3>
                <ul className="list-disc list-inside text-sm text-zinc-700 space-y-1">
                  {retailReport.swot?.pros?.map((p: string, i: number) => <li key={i}>{p}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2 text-red-700">風險提示</h3>
                <div className="space-y-3">
                  {retailReport.swot?.cons?.map((c: any, i: number) => (
                    <div key={i} className="p-3 bg-red-50/50 rounded-xl border border-red-100/50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-bold text-zinc-900">{typeof c === 'string' ? c : c.risk}</span>
                        {c.level && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRiskLevelColor(c.level)}`}>
                            風險：{c.level}
                          </span>
                        )}
                      </div>
                      {c.basis && (
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          <strong>依據：</strong>{c.basis}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">6. 投資建議</h3>
              <div className="text-sm text-zinc-700 space-y-2">
                <p><strong>適合誰：</strong> {retailReport.investmentAdvice?.suitableFor}</p>
                <p><strong>不適合誰：</strong> {retailReport.investmentAdvice?.notSuitableFor}</p>
                <p><strong>操作建議：</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  {retailReport.investmentAdvice?.tips?.map((t: string, i: number) => <li key={i}>{t}</li>)}
                </ul>
                <p><strong>監控重點：</strong></p>
                <ul className="list-disc list-inside space-y-1">
                  {retailReport.investmentAdvice?.monitoringPoints?.map((p: string, i: number) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-4">7. 投資策略 (短/中/長期買賣、止盈、止損)</h3>
              <div className="space-y-4">
                {/* Term Strategies */}
                {[
                  { label: '短期策略 (1-4週)', data: retailReport.investmentStrategy?.shortTerm },
                  { label: '中期策略 (1-6個月)', data: retailReport.investmentStrategy?.mediumTerm },
                  { label: '長期策略 (6個月以上)', data: retailReport.investmentStrategy?.longTerm }
                ].map((term, i) => (
                  <div key={i} className="p-4 bg-zinc-50 rounded-xl border border-zinc-100">
                    <h4 className="font-bold text-zinc-900 mb-2">{term.label}</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <p><span className="text-zinc-500">建議操作：</span><span className="font-medium">{term.data?.action}</span></p>
                      <p><span className="text-zinc-500">目標區間：</span><span className="font-medium text-emerald-600">{term.data?.targetRange}</span></p>
                      <p><span className="text-zinc-500">買入點位：</span><span>{term.data?.buyPoint}</span></p>
                      <p><span className="text-zinc-500">賣出點位：</span><span>{term.data?.sellPoint}</span></p>
                      <div className="md:col-span-2 mt-1 p-2 bg-amber-50 rounded border border-amber-100">
                        <p className="text-xs text-amber-700"><strong>風險提示：</strong>{term.data?.riskWarning}</p>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Exit Strategies */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                    <h4 className="font-bold text-emerald-900 mb-1">止盈水平 (Take Profit)</h4>
                    <p className="text-lg font-bold text-emerald-600 mb-1">{retailReport.investmentStrategy?.takeProfit?.value}</p>
                    <p className="text-xs text-emerald-700"><strong>設定依據：</strong>{retailReport.investmentStrategy?.takeProfit?.basis}</p>
                  </div>
                  <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                    <h4 className="font-bold text-red-900 mb-1">止損水平 (Stop Loss)</h4>
                    <p className="text-lg font-bold text-red-600 mb-1">{retailReport.investmentStrategy?.stopLoss?.value}</p>
                    <p className="text-xs text-red-700"><strong>設定依據：</strong>{retailReport.investmentStrategy?.stopLoss?.basis}</p>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold mb-2">總結</h3>
              <p className="text-zinc-700 font-medium">{retailReport.conclusion}</p>
            </section>

            {/* AI Q&A Section */}
            <section className="mt-8 pt-6 border-t border-zinc-200">
              <h3 className="text-lg font-semibold mb-4">AI 智能問答</h3>
              <div className="space-y-4">
                <input
                  type="text"
                  value={qaInput}
                  onChange={(e) => setQaInput(e.target.value)}
                  placeholder="針對此報告提問..."
                  className="w-full p-3 border border-zinc-300 rounded-xl"
                />
                <button 
                  onClick={handleQA} 
                  disabled={qaLoading} 
                  className="w-full bg-emerald-500 text-white p-3 rounded-xl font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                >
                  {qaLoading ? '思考中...' : '提問'}
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
            <h3 className="text-lg font-semibold mb-2">綜合技術與基本面分析</h3>
            <p className="text-zinc-700 whitespace-pre-wrap">{analysis}</p>
          </motion.div>
        )}
      </div>
    );
  };


  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col md:flex-row font-sans">
      <Toaster />
      {/* Mobile Header */}
      <header className="md:hidden bg-white border-b border-zinc-200 p-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-900 flex items-center gap-2">
          <TrendingUp className="text-emerald-500" />
          AI投資分析
        </h1>
        <button onClick={() => setIsMenuOpen(!isMenuOpen)}>
          {isMenuOpen ? <X /> : <Menu />}
        </button>
      </header>

      {/* Sidebar / Mobile Menu */}
      <aside className={`${isMenuOpen ? 'block' : 'hidden'} md:block w-full md:w-64 bg-white border-r border-zinc-200 p-6`}>
        <h1 className="hidden md:flex text-xl font-bold text-zinc-900 mb-8 items-center gap-2">
          <TrendingUp className="text-emerald-500" />
          AI投資分析工具
        </h1>
        
        <nav className="space-y-2">
          <p className="text-sm text-zinc-500 mb-2">選擇功能</p>
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
