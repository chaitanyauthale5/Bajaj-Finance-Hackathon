import { NextResponse, NextRequest } from 'next/server';
import { POST as runApiPOST } from '../runapi/route';

export const runtime = 'nodejs';

function unauthorized(msg = 'Unauthorized') {
  return NextResponse.json({ error: msg }, { status: 401 });
}

export async function POST(req: NextRequest) {
  // Bearer token auth
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const required = process.env.TEAM_TOKEN || '';
  if (!required) {
    return NextResponse.json({ error: 'Server misconfiguration: TEAM_TOKEN missing' }, { status: 500 });
  }
  if (token !== required) {
    return unauthorized('Invalid or missing bearer token');
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Normalize inputs
  let { documents, questions } = body || {};
  if (!documents) {
    return NextResponse.json({ error: 'documents is required' }, { status: 400 });
  }
  if (typeof documents === 'string') {
    documents = [documents];
  }
  if (!Array.isArray(documents)) {
    return NextResponse.json({ error: 'documents must be a string or array of strings' }, { status: 400 });
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ error: 'questions must be a non-empty array of strings' }, { status: 400 });
  }

  // Delegate to existing implementation (runapi)
  let innerResp: Response;
  try {
    const innerReq = new NextRequest('http://internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' } as any,
      body: JSON.stringify({ documents, questions }),
    } as any);
    innerResp = await runApiPOST(innerReq as any);
  } catch (e: any) {
    const msg = e?.message || String(e);
    return NextResponse.json({ step: 'delegate', error: msg }, { status: 500 });
  }

  let innerJson: any;
  try {
    innerJson = await innerResp.json();
  } catch {
    const text = await innerResp.text();
    return NextResponse.json({ step: 'delegate-parse', status: innerResp.status, body: text }, { status: 500 });
  }

  // Expected inner shape: { answers: [{ answer, citations }], diagnostics }
  const answers = Array.isArray(innerJson?.answers) ? innerJson.answers : [];

  const structured = answers.map((a: any) => {
    const answerText = typeof a?.answer === 'string' ? a.answer : JSON.stringify(a?.answer ?? '');
    const citations = Array.isArray(a?.citations) ? a.citations : [];

    // Heuristic mapping without a full evaluator
    const isUnknown = /i don't know/i.test(answerText) || answerText.trim() === '';
    const decision = isUnknown ? 'needs_info' : 'informational';

    return {
      decision,            // informational | needs_info (no evaluator)
      amount: null,        // not computed without evaluator
      justification: answerText,
      clause_mapping: citations.map((c: any) => ({
        doc_name: c?.doc_name,
        chunk_id: c?.chunk_id,
        snippet: null, // snippets not available from delegated response
      })),
    };
  });

  const out = {
    answers: structured,
    diagnostics: innerJson?.diagnostics ?? null,
  };

  return NextResponse.json(out);
}
