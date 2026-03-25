import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function analyzeStock(symbol: string, price: number, change: number): Promise<string> {
  const prompt = `Analyze the following stock data: Symbol: ${symbol}, Price: $${price}, Change: ${change}%. Provide a brief market sentiment analysis. Please provide your response in Chinese (中文).`;
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text || "No analysis available.";
  } catch (error) {
    console.error("Error analyzing stock:", error);
    return "Could not perform analysis at this time.";
  }
}
