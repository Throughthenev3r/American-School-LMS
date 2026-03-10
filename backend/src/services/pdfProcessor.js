/**
 * PDF text extraction and chunking for AI/RAG pipeline.
 * Extracts text from PDFs and splits into overlapping chunks.
 */
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 100;

/**
 * Extracts text from a PDF file.
 * @param {string} filePath - Absolute path to the PDF file
 * @returns {Promise<string>} Extracted text
 */
export async function extractTextFromPdf(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('File not found: ' + filePath);
  }
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text || '';
}

/**
 * Splits text into chunks with overlap for context continuity.
 * @param {string} text - Raw text
 * @param {number} size - Chunk size in characters
 * @param {number} overlap - Overlap between chunks
 * @returns {Array<{content: string, index: number}>}
 */
export function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || typeof text !== 'string') return [];
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const chunks = [];
  let start = 0;
  let index = 0;

  while (start < cleaned.length) {
    const end = Math.min(start + size, cleaned.length);
    const content = cleaned.slice(start, end).trim();
    if (content) {
      chunks.push({ content, index });
      index++;
    }
    start += size - overlap;
  }
  return chunks;
}

/**
 * Full pipeline: read PDF → extract text → chunk.
 * @param {string} filePath - Path to PDF
 * @returns {Promise<Array<{content: string, index: number}>>}
 */
export async function processPdfToChunks(filePath) {
  const text = await extractTextFromPdf(filePath);
  return chunkText(text);
}
