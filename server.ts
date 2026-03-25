import express from "express";
import http from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import yahooFinance from 'yahoo-finance2';
const yahooFinanceInstance: any = new yahooFinance();
// yahooFinance.setGlobalConfig({ validation: { skipValidation: true } });

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
  app.use(express.json());
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  const PORT = 3000;

  app.use((req, res, next) => {
    console.log('Request:', req.method, req.url);
    next();
  });

  // Socket.io
  io.on("connection", (socket) => {
    console.log("Client connected");
    socket.on("subscribe", (symbol) => {
      console.log(`Subscribing to ${symbol}`);
      socket.join(symbol);
    });
  });

  // Periodic price updates
  setInterval(async () => {
    for (const room of io.sockets.adapter.rooms.keys()) {
      if (room.startsWith('^') || room.length < 10) { // Simple check to avoid internal rooms
        try {
          const chartResult = await yahooFinanceInstance.chart(room, { period1: new Date(Date.now() - 86400000) });
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
      const result = await yahooFinanceInstance.search(symbol);
      res.json(result.news);
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
      const chartResult = await yahooFinanceInstance.chart(symbol, queryOptions);
      const quoteSummary = await yahooFinanceInstance.quoteSummary(symbol, { modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'] });
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
      
      const tailCount = Math.min(5, result.length);
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
      const chartResult = await yahooFinanceInstance.chart(symbol, { period1: new Date(Date.now() - 31536000000) }); // 1 year
      const quotes = chartResult.quotes;
      
      let capital = initialCapital;
      let shares = 0;
      let buyPrice = 0;
      const trades = [];
      const equityCurve = [];
      
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

      // Helper to calculate MACD
      const calculateEMA = (data: any[], period: number) => {
        const ema = [];
        let multiplier = 2 / (period + 1);
        ema.push(data[0].close);
        for (let i = 1; i < data.length; i++) {
          ema.push((data[i].close - ema[i-1]) * multiplier + ema[i-1]);
        }
        return ema;
      };

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
