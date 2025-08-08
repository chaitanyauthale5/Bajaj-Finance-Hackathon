import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pinecone } from '@pinecone-database/pinecone';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY as string);
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const INDEX_NAME = process.env.PINECONE_INDEX || 'bajaj2';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-004';
const PINECONE_DIM = parseInt(process.env.PINECONE_DIM || '1536', 10);

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function embedWithRetry(input: string, attempt = 0): Promise<number[]> {
  const maxAttempts = 5;
  const backoff = Math.min(1000 * Math.pow(2, attempt), 15000); // 1s,2s,4s,8s,15s
  try {
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const resp = await model.embedContent(input);
    return resp.embedding.values as unknown as number[];
  } catch (e: any) {
    const msg = e?.message || String(e);
    const isRetryable = msg.includes('429') || e?.status === 429 || (e?.status && e.status >= 500) || /timeout/i.test(msg);
    if (isRetryable && attempt < maxAttempts - 1) {
      await sleep(backoff);
      return embedWithRetry(input, attempt + 1);
    }
    throw e;
  }
}

export async function embedChunks(chunks: any[]) {
  // Get embeddings for all chunks
  const texts = chunks.map((c) => c.text);
  const embeddings = await getEmbeddings(texts);
  // Prepare Pinecone vectors
  const vectors = chunks.map((c, i) => ({
    id: `${c.doc_name}_${c.chunk_id}`,
    values: adaptToPineconeDim(embeddings[i]),
    metadata: { doc_name: c.doc_name, chunk_id: c.chunk_id, text: c.text },
  }));
  // Upsert to Pinecone
  const index = pinecone.index(INDEX_NAME);
  await index.upsert(vectors as any[]); // Pinecone typing workaround
  return { vectors, vectorStore: index, chunks };
}

export async function getEmbeddings(texts: string[]) {
  const results: number[][] = [];
  // Basic batching to avoid hitting rate limits
  const batchSize = 8; // conservative
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    // Fall back to per-item retry to better handle 429s
    const batchEmbeds = [] as number[][];
    for (const t of batch) {
      const embedding = await embedWithRetry(t.slice(0, 2000));
      batchEmbeds.push(embedding);
    }
    results.push(...batchEmbeds);
  }
  return results;
}

export async function searchRelevantChunks(question: string, vectorStore: any, chunks: any[], topK = 4) {
  // Embed the question
  const [qEmbedding] = await getEmbeddings([question]);
  // Query Pinecone
  const queryRes = await vectorStore.query({
    vector: adaptToPineconeDim(qEmbedding),
    topK,
    includeMetadata: true,
  });
  // Map Pinecone results back to chunk objects
  const topChunks = queryRes.matches.map((match: any) => ({
    doc_name: match.metadata.doc_name,
    chunk_id: match.metadata.chunk_id,
    text: match.metadata.text,
    score: match.score,
  }));
  return topChunks;
}

function adaptToPineconeDim(vec: number[]): number[] {
  if (vec.length === PINECONE_DIM) return vec;
  if (PINECONE_DIM % vec.length === 0) {
    const times = PINECONE_DIM / vec.length;
    const out: number[] = [];
    for (let i = 0; i < times; i++) out.push(...vec);
    return out;
  }
  if (vec.length > PINECONE_DIM) return vec.slice(0, PINECONE_DIM);
  // pad with zeros
  return [...vec, ...new Array(PINECONE_DIM - vec.length).fill(0)];
}
