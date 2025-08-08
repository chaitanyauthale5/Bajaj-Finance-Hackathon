import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY as string);
const CHAT_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function chatWithRetry(prompt: string, attempt = 0) {
  const maxAttempts = 5;
  const backoff = Math.min(1000 * Math.pow(2, attempt), 15000);
  try {
    const model = genAI.getGenerativeModel({ model: CHAT_MODEL });
    return await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 350, temperature: 0.2 },
    } as any);
  } catch (e: any) {
    const msg = e?.message || String(e);
    const isRetryable = e?.status === 429 || (e?.status && e.status >= 500) || /timeout/i.test(msg);
    if (isRetryable && attempt < maxAttempts - 1) {
      await sleep(backoff);
      return chatWithRetry(prompt, attempt + 1);
    }
    throw e;
  }
}

export async function getLLMAnswer(question: string, topChunks: any[]): Promise<any> {
  const context = topChunks
    .map((c: any, i: number) => `Chunk ${i + 1} (doc: ${c.doc_name}, id: ${c.chunk_id}):\n${c.text}`)
    .join('\n\n');
  const prompt = `You are a highly accurate insurance policy clause evaluator. Always cite sources.\n\nContext:\n${context}\n\nQuestion: ${question}\n\nRespond ONLY in JSON with keys: answer, citations (array of {doc_name, chunk_id}). If not covered in context, set answer to "I don't know" and citations to [].`;

  const completion = await chatWithRetry(prompt);
  const raw = completion.response.text() || '';
  // Sanitize Markdown fences and extract first JSON object
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let json: any = null;
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/); // greedy match first {...}
  const candidate = jsonMatch ? jsonMatch[0] : cleaned;
  try {
    json = JSON.parse(candidate);
  } catch {
    // fallback: return plain text
    json = { answer: cleaned, citations: topChunks.slice(0, 2).map((c: any) => ({ doc_name: c.doc_name, chunk_id: c.chunk_id })) };
  }
  return json;
}
