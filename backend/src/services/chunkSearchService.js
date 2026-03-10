/**
 * Search relevant document chunks for RAG.
 * Filters by student enrollment — only chunks from assignments in the student's classes.
 *
 * Search strategy:
 * 1. Semantic search (embeddings + cosine similarity) when OpenAI key + embedding column available
 * 2. Fallback to full-text search (websearch_to_tsquery) otherwise
 */
const MAX_CHUNKS = 10;
const MAX_CHARS_TOTAL = 6000;

/** OpenAI text-embedding-3-small dimension */
const EMBEDDING_DIM = 1536;

/**
 * Generates embedding for text using OpenAI text-embedding-3-small.
 * @param {string} apiKey - OpenAI API key
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>} Embedding vector or null on failure
 */
async function getQuestionEmbedding(apiKey, text) {
  if (!apiKey || !text) return null;
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });
    const { data } = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.trim().slice(0, 8000),
    });
    const embedding = data?.[0]?.embedding;
    return Array.isArray(embedding) && embedding.length === EMBEDDING_DIM ? embedding : null;
  } catch (_) {
    return null;
  }
}

/**
 * Semantic search: ranks chunks by cosine similarity between question embedding and chunk embedding.
 * Requires: pgvector extension, document_chunks.embedding column (vector(1536)), embeddings populated.
 */
async function semanticSearch(pool, embedding, studentId) {
  const vectorStr = '[' + embedding.join(',') + ']';
  const { rows } = await pool.query(
    `WITH allowed AS (
       SELECT aa.id AS attachment_id, a.title AS assignment_title, aa.original_filename AS file_name
       FROM assignment_attachments aa
       JOIN assignments a ON a.id = aa.assignment_id
       JOIN enrollments e ON e.class_section_id = a.class_section_id AND e.student_id = $2
     )
     SELECT dc.id, dc.content, dc.source_type, dc.source_id, al.assignment_title, al.file_name
     FROM document_chunks dc
     JOIN allowed al ON al.attachment_id = dc.source_id
     WHERE dc.source_type = 'assignment_attachment'
       AND dc.source_id IN (SELECT attachment_id FROM allowed)
       AND dc.embedding IS NOT NULL
     ORDER BY dc.embedding <=> $1::vector ASC
     LIMIT $3`,
    [vectorStr, studentId, MAX_CHUNKS * 3]
  );
  return rows;
}

/**
 * Full-text search: uses websearch_to_tsquery for flexible phrase/term matching.
 * Falls back to plainto_tsquery if websearch_to_tsquery throws (e.g. malformed input).
 */
async function fullTextSearch(pool, query, studentId) {
  const baseQuery = (tsqueryFn) => `WITH allowed AS (
       SELECT aa.id AS attachment_id, a.title AS assignment_title, aa.original_filename AS file_name
       FROM assignment_attachments aa
       JOIN assignments a ON a.id = aa.assignment_id
       JOIN enrollments e ON e.class_section_id = a.class_section_id AND e.student_id = $2
     ),
     ranked AS (
       SELECT dc.id, dc.content, dc.source_type, dc.source_id, al.assignment_title, al.file_name,
              ts_rank(to_tsvector('simple', dc.content), ${tsqueryFn}) AS rank
       FROM document_chunks dc
       JOIN allowed al ON al.attachment_id = dc.source_id
       WHERE dc.source_type = 'assignment_attachment'
         AND dc.source_id IN (SELECT attachment_id FROM allowed)
         AND to_tsvector('simple', dc.content) @@ ${tsqueryFn}
     )
     SELECT id, content, source_type, source_id, assignment_title, file_name
     FROM ranked
     ORDER BY rank DESC
     LIMIT $3`;

  try {
    const { rows } = await pool.query(
      baseQuery("websearch_to_tsquery('simple', $1)"),
      [query, studentId, MAX_CHUNKS * 3]
    );
    return rows;
  } catch (_) {
    const { rows } = await pool.query(
      baseQuery("plainto_tsquery('simple', $1)"),
      [query, studentId, MAX_CHUNKS * 3]
    );
    return rows;
  }
}

/**
 * Applies chunk limit (10) and char limit (6000) to raw rows.
 */
function applyLimits(rows) {
  let total = 0;
  const result = [];
  for (const r of rows) {
    if (result.length >= MAX_CHUNKS) break;
    if (total + (r.content?.length || 0) > MAX_CHARS_TOTAL) break;
    result.push({
      id: r.id,
      content: r.content,
      source_type: r.source_type,
      source_id: r.source_id,
      assignment_title: r.assignment_title || null,
      file_name: r.file_name || null,
    });
    total += r.content?.length || 0;
  }
  return result;
}

/**
 * Finds chunks relevant to the question, scoped to the student's classes.
 * Tries semantic search first; falls back to full-text search if embeddings unavailable.
 *
 * @param {object} pool - pg Pool
 * @param {string} question - student's question
 * @param {number} studentId - student ID
 * @returns {Promise<Array<{id, content, source_type, source_id}>>}
 */
export async function searchRelevantChunks(pool, question, studentId) {
  const query = String(question || '').trim();
  if (!query) return [];

  try {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;

    if (apiKey) {
      const embedding = await getQuestionEmbedding(apiKey, query);
      if (embedding) {
        const rows = await semanticSearch(pool, embedding, studentId);
        if (rows.length > 0) {
          return applyLimits(rows);
        }
      }
    }

    const rows = await fullTextSearch(pool, query, studentId);
    return applyLimits(rows);
  } catch (_) {
    try {
      const rows = await fullTextSearch(pool, query, studentId);
      return applyLimits(rows);
    } catch (_) {
      return [];
    }
  }
}
