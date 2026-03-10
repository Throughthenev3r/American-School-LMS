/**
 * AI pipeline: runs after PDF upload.
 * Extracts text, chunks it, stores in document_chunks for search/RAG.
 * Runs in background - does not block the upload response.
 */
import path from 'path';
import fs from 'fs';
import { processPdfToChunks } from './pdfProcessor.js';
import { indexDocumentChunks } from './documentIndexService.js';

const PDF_MIME = 'application/pdf';
const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Runs the indexing pipeline for a PDF file.
 * Called asynchronously after upload - errors are logged, not thrown.
 * @param {object} pool - pg Pool instance
 * @param {string} uploadDir - Base upload directory (e.g. backend/uploads)
 * @param {object} file - Multer file object { filename, mimetype, size }
 * @param {string} sourceType - 'assignment_attachment', 'syllabus', 'calendar_event'
 * @param {number} sourceId - ID of the attachment/record
 */
export async function runPdfIndexingPipeline(pool, uploadDir, file, sourceType, sourceId) {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime !== PDF_MIME) return;

  if (file.size > MAX_PDF_SIZE) {
    console.warn(`[AI Pipeline] PDF too large, skip indexing: ${file.originalname}`);
    return;
  }

  const filePath = path.join(uploadDir, file.filename);
  if (!fs.existsSync(filePath)) return;

  try {
    const chunks = await processPdfToChunks(filePath);
    if (chunks.length === 0) return;

    await indexDocumentChunks(pool, { sourceType, sourceId, chunks });
    console.log(`[AI Pipeline] Indexed ${chunks.length} chunks for ${sourceType}:${sourceId}`);
  } catch (err) {
    console.error('[AI Pipeline] Error:', err.message);
  }
}
