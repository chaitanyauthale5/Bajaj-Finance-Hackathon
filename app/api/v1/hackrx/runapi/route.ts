import { NextRequest } from 'next/server';

// Force Node.js runtime to support Node-only deps used in POST (pdf-parse, mammoth, etc.)
export const runtime = 'nodejs';

export async function GET() {
  return new Response(JSON.stringify({ status: 'ok' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { documents, questions } = body || {};

    if (!documents || (Array.isArray(documents) && documents.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: documents (string or string[])' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: questions (string[])' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Lazy-import heavy Node-only modules to keep GET lightweight and avoid edge bundling
    const { downloadAndParseDocs } = await import('../../../../utils/doc_processing');
    const { embedChunks, searchRelevantChunks } = await import('../../../../utils/semantic_search');
    const { getLLMAnswer } = await import('../../../../utils/llm_reasoning');

    // 1) Download, parse, and chunk documents
    let chunks: any[] = [];
    try {
      chunks = await downloadAndParseDocs(documents);
    } catch (e: any) {
      console.error('downloadAndParseDocs error:', e);
      return new Response(
        JSON.stringify({ step: 'downloadAndParseDocs', error: e?.message || String(e) }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Optionally limit number of chunks to reduce embedding load
    const maxChunksEnv = process.env.MAX_CHUNKS ? parseInt(process.env.MAX_CHUNKS, 10) : undefined;
    const chunksToEmbed = maxChunksEnv && Number.isFinite(maxChunksEnv)
      ? chunks.slice(0, Math.max(0, maxChunksEnv))
      : chunks;

    // 2) Embed chunks and upsert to Pinecone
    let vectorStore: any;
    let fallbackUsed = false;
    try {
      const res = await embedChunks(chunksToEmbed);
      vectorStore = res.vectorStore;
    } catch (e: any) {
      console.error('embedChunks/Pinecone upsert error:', e);
      // Fallback: proceed without embeddings using naive keyword overlap selection
      fallbackUsed = true;
    }

    // 3) For each question: retrieve top chunks and ask LLM
    const answers = [] as any[];
    for (const q of questions) {
      try {
        let topChunks: any[] = [];
        if (vectorStore && !fallbackUsed) {
          topChunks = await searchRelevantChunks(q, vectorStore, chunks, 4);
        } else {
          // Naive selection: score chunks by keyword overlap with the question
          const qTerms = q.toLowerCase().split(/\W+/).filter(Boolean);
          const scored = chunks.map((c) => {
            const text = (c.text || '').toLowerCase();
            let score = 0;
            for (const t of qTerms) {
              if (text.includes(t)) score += 1;
            }
            return { ...c, score };
          });
          scored.sort((a, b) => b.score - a.score);
          topChunks = scored.slice(0, 4);
        }
        const ans = await getLLMAnswer(q, topChunks);
        answers.push(ans);
      } catch (e: any) {
        console.error('Question processing error:', e);
        answers.push({ question: q, error: e?.message || String(e) });
      }
    }

    return new Response(JSON.stringify({
      answers,
      diagnostics: {
        totalChunks: chunks.length,
        embeddedChunks: chunksToEmbed.length,
        maxChunks: maxChunksEnv ?? null,
        embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-large',
        fallbackUsed,
      },
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    const message = err?.message || 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
