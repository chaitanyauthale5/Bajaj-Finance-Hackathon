import axios from 'axios';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { simpleParser } from 'mailparser';

export async function downloadAndParseDocs(documents: string | string[]) {
  if (!Array.isArray(documents)) documents = [documents];
  let allChunks: any[] = [];
  for (const docUrl of documents) {
    const res = await axios.get(docUrl, { responseType: 'arraybuffer', headers: { Accept: 'application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, message/rfc822, */*' } });
    const buffer = Buffer.from(res.data);
    // Use URL API to robustly extract extension and name (handles query strings)
    let text = '';
    const urlObj = new URL(docUrl);
    const pathname = urlObj.pathname; // e.g., /path/to/file.pdf
    const docName = pathname.split('/').pop() || 'document';
    const ext = docName.toLowerCase().split('.').pop();
    if (ext === 'pdf') {
      const pdfData = await pdfParse(buffer);
      text = pdfData.text;
    } else if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (ext === 'eml') {
      const mail = await simpleParser(buffer);
      text = mail.text || '';
    } else {
      throw new Error('Unsupported file type: ' + ext + ' (from: ' + docName + ')');
    }
    const chunks = chunkDocumentText(text, docName);
    allChunks = allChunks.concat(chunks);
  }
  return allChunks;
}

export function chunkDocumentText(text: string, docName: string) {
  // Simple ~400 token chunking (tokens ~= words/0.75)
  const words = text.split(/\s+/);
  const chunkSize = 500; // ~400-500 tokens
  let chunks: any[] = [];
  let chunkId = 0;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunkText = words.slice(i, i + chunkSize).join(' ');
    chunks.push({ doc_name: docName, chunk_id: chunkId++, text: chunkText });
  }
  return chunks;
}
