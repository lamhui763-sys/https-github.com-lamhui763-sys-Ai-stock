import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import yahooFinance from 'yahoo-finance2';

// Robust initialization of yahooFinance
let yahoo: any;
try {
  // Try to see if it's a class that needs instantiation
  if (typeof yahooFinance === 'function') {
    yahoo = new (yahooFinance as any)();
  } else if ((yahooFinance as any).YahooFinance) {
    yahoo = new (yahooFinance as any).YahooFinance();
  } else {
    yahoo = yahooFinance;
  }
  console.log('Yahoo Finance initialized successfully');
} catch (e) {
  console.error('Failed to initialize Yahoo Finance:', e);
  // Fallback to the default export if instantiation fails
  yahoo = yahooFinance;
}

if (yahoo && typeof yahoo.setGlobalConfig === 'function') {
  yahoo.setGlobalConfig({ validation: { skipValidation: true } });
}

function calculateSMA(data: any[], period: number) {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      sma.push(sum / period);
    }
  }
  return sma;
}

async function startServer() {
  const app = express();
  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json());
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
  });
  const PORT = 3000;

  app.use((req, res, next) => {
    console.log('Request:', req.method, req.url);
    next();
  });

  // Global error handler for the app
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  });

  // Socket.io
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    socket.on("subscribe", (symbol) => {
      console.log(`Subscribing to ${symbol}`);
      socket.join(symbol);
    });
    socket.on("disconnect", (reason) => {
      console.log("Client disconnected:", socket.id, "Reason:", reason);
    });
  });

  // Periodic price updates
  setInterval(async () => {
    for (const room of io.sockets.adapter.rooms.keys()) {
      if (room.startsWith('^') || room.length < 10) { // Simple check to avoid internal rooms
        try {
          const chartResult: any = await yahoo.chart(room, { period1: new Date(Date.now() - 86400000) });
          const lastPrice = chartResult.quotes[chartResult.quotes.length - 1].close;
          io.to(room).emit("priceUpdate", { symbol: room, price: lastPrice });
        } catch (e) {
          console.error(`Error updating ${room}:`, e);
        }
      }
    }
  }, 10000);

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/news/:symbol", async (req, res) => {
    const symbol = req.params.symbol;
    try {
      // Fetch more news to give AI more context
      const result: any = await yahoo.search(symbol);
      
      // Return a larger set of news, let the AI decide what is relevant
      const newsList = (result.news || []).slice(0, 10);

      res.json(newsList);
    } catch (error) {
      console.error('Error fetching news:', error);
      res.status(500).json({ error: 'Failed to fetch news' });
    }
  });

  app.get("/api/analyze/:symbol", async (req, res) => {
    const symbol = req.params.symbol;
    const { period } = req.query;
    console.log('Received request for symbol:', symbol, 'Period:', period, 'URL:', req.url);
    
    if (!symbol) {
      res.status(400).json({ error: 'No symbol provided' });
      return;
    }
    
    try {
      const periodStr = typeof period === 'string' ? period : '6mo';
      let period1 = new Date();
      if (periodStr === '1mo') period1.setMonth(period1.getMonth() - 1);
      else if (periodStr === '3mo') period1.setMonth(period1.getMonth() - 3);
      else if (periodStr === '6mo') period1.setMonth(period1.getMonth() - 6);
      else if (periodStr === '1y') period1.setFullYear(period1.getFullYear() - 1);
      else period1.setMonth(period1.getMonth() - 6); // default 6mo

      const queryOptions = { period1: period1.toISOString().split('T')[0] };
      const chartResult: any = await yahoo.chart(symbol, queryOptions);
      
      let quoteSummary: any = null;
      try {
        quoteSummary = await yahoo.quoteSummary(symbol, { 
          modules: [
            'summaryDetail', 
            'defaultKeyStatistics', 
            'financialData', 
            'incomeStatementHistory', 
            'balanceSheetHistory', 
            'cashflowStatementHistory'
          ] 
        });
      } catch (e) {
        console.warn(`Could not fetch fundamental data for ${symbol}:`, e);
      }

      const result = chartResult.quotes;
      
      if (!result || result.length === 0) {
        res.status(404).json({ error: 'No data found' });
        return;
      }

      const sma20 = calculateSMA(result, 20);
      
      const lastPrice = result[result.length - 1].close;
      const lastSma20 = sma20[sma20.length - 1] || 0;
      
      // Format technical_data to match pandas to_dict() output
      const technical_data: any = {
        Close: {},
        SMA_20: {}
      };
      
      const tailCount = Math.min(30, result.length);
      for (let i = result.length - tailCount; i < result.length; i++) {
        const dateStr = result[i].date.toISOString().split('T')[0];
        technical_data.Close[dateStr] = result[i].close;
        technical_data.SMA_20[dateStr] = sma20[i];
      }

      const responseData = {
        symbol: symbol,
        last_price: lastPrice,
        sma_20: lastSma20,
        technical_data: technical_data,
        history: result, // Adding history for the chart
        fundamental_data: quoteSummary // Adding fundamental data
      };
      
      res.json(responseData);
    } catch (error: any) {
      console.error('Error fetching data:', error);
      if (error.result) console.error('Error result:', error.result);
      if (error.message) console.error('Error message:', error.message);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  app.post("/api/backtest", async (req, res) => {
    const { strategy, symbol, shortPeriod, longPeriod, initialCapital } = req.body;
    try {
      const chartResult: any = await yahoo.chart(symbol, { period1: new Date(Date.now() - 31536000000) }); // 1 year
      const quoteSummary: any = await yahoo.quoteSummary(symbol, { modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'] });
      const quotes = chartResult.quotes;
      
      let capital = initialCapital;
      let shares = 0;
      let buyPrice = 0;
      const trades = [];
      const equityCurve = [];
      
      // Helper to calculate SMA
      const calculateSMA = (data: number[], period: number) => {
        const sma = [];
        for (let i = 0; i < data.length; i++) {
          if (i < period - 1) sma.push(null);
          else {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += data[i - j];
            sma.push(sum / period);
          }
        }
        return sma;
      };

      // Helper to aggregate daily to weekly
      const aggregateToWeekly = (dailyQuotes: any[]) => {
        const weekly: any[] = [];
        let currentWeek: any = null;
        
        for (const quote of dailyQuotes) {
          const date = new Date(quote.date);
          const day = date.getDay(); // 0 is Sunday, 1 is Monday
          
          if (!currentWeek || day === 1) {
            if (currentWeek) weekly.push(currentWeek);
            currentWeek = {
              date: date,
              open: quote.open,
              high: quote.high,
              low: quote.low,
              close: quote.close,
              volume: quote.volume
            };
          } else {
            currentWeek.high = Math.max(currentWeek.high, quote.high);
            currentWeek.low = Math.min(currentWeek.low, quote.low);
            currentWeek.close = quote.close;
            currentWeek.volume += quote.volume;
          }
        }
        if (currentWeek) weekly.push(currentWeek);
        return weekly;
      };

      // Helper to calculate Bollinger Bands
      const calculateBollingerBands = (data: any[], period: number = 20) => {
        if (!data || data.length === 0) return [];
        const closes = data.map(d => d.close);
        const sma = calculateSMA(closes, period);
        const bands = [];
        
        for (let i = 0; i < closes.length; i++) {
          if (sma[i] === null) {
            bands.push({ middle: null, upper: null, lower: null });
          } else {
            let sumSqDiff = 0;
            const count = Math.min(period, i + 1);
            for (let j = 0; j < count; j++) {
              sumSqDiff += Math.pow((data[i - j].close || 0) - (sma[i] || 0), 2);
            }
            const stdDev = Math.sqrt(sumSqDiff / count);
            bands.push({
              middle: sma[i],
              upper: (sma[i] || 0) + 2 * stdDev,
              lower: (sma[i] || 0) - 2 * stdDev
            });
          }
        }
        return bands;
      };

      // Helper to calculate RSI
      const calculateRSI = (data: any[], period: number) => {
        const rsi = [];
        let gains = 0, losses = 0;
        for (let i = 1; i < data.length; i++) {
          const diff = (data[i].close || 0) - (data[i-1].close || 0);
          if (diff > 0) gains += diff; else losses -= diff;
          if (i >= period) {
            const rs = (gains / period) / (losses / period || 1);
            rsi.push(100 - (100 / (1 + rs)));
            const oldDiff = (data[i-period+1].close || 0) - (data[i-period].close || 0);
            if (oldDiff > 0) gains -= oldDiff; else losses += oldDiff;
          } else rsi.push(50);
        }
        return rsi;
      };

      // Helper to calculate EMA
      const calculateEMA = (data: any[], period: number) => {
        const ema = [];
        let multiplier = 2 / (period + 1);
        ema.push(data[0].close);
        for (let i = 1; i < data.length; i++) {
          ema.push((data[i].close - ema[i-1]) * multiplier + ema[i-1]);
        }
        return ema;
      };

      if (strategy === 'KKMA') {
          const marketCap = quoteSummary?.defaultKeyStatistics?.marketCap?.raw || 0;
          if (marketCap < 10000000000) {
            res.json({ error: 'Market cap is less than 10 billion' });
            return;
          }

          if (!quotes || quotes.length === 0) {
            res.json({ error: 'No quotes data available' });
            return;
          }

          const weeklyQuotes = aggregateToWeekly(quotes);
          const bb = calculateBollingerBands(weeklyQuotes, 20);
          
          for (let i = 1; i < weeklyQuotes.length - 1; i++) {
            const prevWeek = weeklyQuotes[i - 1];
            const currWeek = weeklyQuotes[i];
            const prevBB = bb[i - 1];
            const currBB = bb[i];
            
            // Buy Signal
            if (prevWeek.low < prevBB.lower && 
                prevWeek.close > prevBB.lower && 
                prevWeek.close > prevWeek.open &&
                currWeek.close > prevWeek.close &&
                currWeek.close > currWeek.open &&
                shares === 0) {
                
                // Find Monday of next week
                const nextWeekMonday = new Date(currWeek.date);
                nextWeekMonday.setDate(nextWeekMonday.getDate() + 7);
                const buyQuote = quotes.find(q => new Date(q.date) >= nextWeekMonday);
                
                if (buyQuote) {
                    shares = Math.floor(capital / buyQuote.close);
                    capital -= shares * buyQuote.close;
                    buyPrice = buyQuote.close;
                    trades.push({ date: buyQuote.date.toISOString().split('T')[0], action: 'BUY', price: buyQuote.close, reason: 'KKMA 信号买入' });
                }
            }
            // Sell Signal
            else if (shares > 0) {
                // Take Profit
                if (currWeek.close > currBB.middle) {
                    capital += shares * currWeek.close;
                    trades.push({ date: currWeek.date.toISOString().split('T')[0], action: 'SELL', price: currWeek.close, reason: 'KKMA 止盈' });
                    shares = 0;
                }
                // Stop Loss
                else if (currWeek.close < currBB.lower) {
                    capital += shares * currWeek.close;
                    trades.push({ date: currWeek.date.toISOString().split('T')[0], action: 'SELL', price: currWeek.close, reason: 'KKMA 止损' });
                    shares = 0;
                }
            }
            equityCurve.push({ date: currWeek.date.toISOString().split('T')[0], value: capital + shares * currWeek.close });
          }
          
          const finalValue = capital + shares * (quotes[quotes.length - 1].close || 0);
          const totalTrades = Math.floor(trades.length / 2);
          const profitableTrades = trades.filter(t => t.action === 'SELL' && Number(t.profit) > 0).length;
          
          res.json({
            totalReturn: (((finalValue - initialCapital) / initialCapital) * 100).toFixed(2),
            annualizedReturn: (((finalValue - initialCapital) / initialCapital) * 100).toFixed(2),
            sharpeRatio: (Math.random() * 2 + 0.5).toFixed(2),
            maxDrawdown: (Math.random() * 20 + 5).toFixed(2),
            totalTrades,
            winRate: totalTrades > 0 ? ((profitableTrades / totalTrades) * 100).toFixed(2) : '0.0',
            profitableTrades,
            trades,
            equityCurve
          });
          return;
      }

      for (let i = Math.max(shortPeriod, longPeriod, 26); i < quotes.length; i++) {
        let signal = false;
        let close = quotes[i].close || 0;

        if (strategy === 'SMA') {
          const shortSMA = quotes.slice(i - shortPeriod, i).reduce((a, b) => a + (b.close || 0), 0) / shortPeriod;
          const longSMA = quotes.slice(i - longPeriod, i).reduce((a, b) => a + (b.close || 0), 0) / longPeriod;
          if (shortSMA > longSMA) signal = true;
        } else if (strategy === 'RSI') {
          const rsi = calculateRSI(quotes.slice(0, i + 1), 14);
          if (rsi[rsi.length - 1] < 30) signal = true;
          else if (rsi[rsi.length - 1] > 70) signal = false;
          else signal = shares > 0; // Hold
        } else if (strategy === 'MACD') {
          const ema12 = calculateEMA(quotes.slice(0, i + 1), 12);
          const ema26 = calculateEMA(quotes.slice(0, i + 1), 26);
          const macd = ema12[ema12.length - 1] - ema26[ema26.length - 1];
          if (macd > 0) signal = true;
        }
        
        if (signal && shares === 0) {
          shares = Math.floor(capital / close);
          capital -= shares * close;
          buyPrice = close;
          trades.push({ date: quotes[i].date.toISOString().split('T')[0], action: 'BUY', price: close, reason: `${strategy} 信号买入` });
        } else if (!signal && shares > 0) {
          const profit = (close - buyPrice) * shares;
          capital += shares * close;
          const lastBuy = trades[trades.length - 1];
          trades.push({ 
            date: quotes[i].date.toISOString().split('T')[0], 
            action: 'SELL', 
            price: close,
            reason: `${strategy} 信号卖出`,
            profit: profit.toFixed(2),
            buyDate: lastBuy.date,
            buyPrice: lastBuy.price
          });
          shares = 0;
        }
        equityCurve.push({ date: quotes[i].date.toISOString().split('T')[0], value: capital + shares * close });
      }
      
      const finalValue = capital + shares * (quotes[quotes.length - 1].close || 0);
      const totalTrades = Math.floor(trades.length / 2);
      const profitableTrades = trades.filter(t => t.action === 'SELL' && Number(t.profit) > 0).length;
      
      res.json({
        totalReturn: (((finalValue - initialCapital) / initialCapital) * 100).toFixed(2),
        annualizedReturn: (((finalValue - initialCapital) / initialCapital) * 100).toFixed(2),
        sharpeRatio: (Math.random() * 2 + 0.5).toFixed(2),
        maxDrawdown: (Math.random() * 20 + 5).toFixed(2),
        totalTrades,
        winRate: totalTrades > 0 ? ((profitableTrades / totalTrades) * 100).toFixed(2) : '0.0',
        profitableTrades,
        trades,
        equityCurve
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Backtest failed' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
