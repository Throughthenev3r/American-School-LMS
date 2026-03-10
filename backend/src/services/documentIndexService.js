/**
 * Saves document chunks to database for search/RAG.
 * Replaces existing chunks for the same source.
 * Generates embeddings when OPENAI_API_KEY is set for semantic search.
 */
const EMBEDDING_DIM = 1536;

/**
 * Generates embeddings for texts via OpenAI text-embedding-3-small (batch).
 * @returns {Promise<number[][]|null>} Array of embeddings or null on failure
 */
async function getEmbeddings(texts) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  if (!apiKey || !texts?.length) return null;
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });
    const input = texts.map((t) => String(t || '').trim().slice(0, 8000));
    const { data } = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input,
    });
    const embeddings = data?.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (!embeddings?.every((e) => Array.isArray(e) && e.length === EMBEDDING_DIM)) return null;
    return embeddings;
  } catch (_) {
    return null;
  }
}

export async function indexDocumentChunks(pool, { sourceType, sourceId, chunks }) {
  if (!chunks || chunks.length === 0) return { indexed: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'DELETE FROM document_chunks WHERE source_type = $1 AND source_id = $2',
      [sourceType, sourceId]
    );

    const contents = chunks.map((c) => c.content);
    const embeddings = await getEmbeddings(contents);

    for (let i = 0; i < chunks.length; i++) {
      const { content, index } = chunks[i];
      const embedding = embeddings?.[i];
      const vectorStr = embedding ? '[' + embedding.join(',') + ']' : null;

      try {
        if (vectorStr) {
          await client.query(
            `INSERT INTO document_chunks (source_type, source_id, chunk_index, content, char_count, embedding)
             VALUES ($1, $2, $3, $4, $5, $6::vector)`,
            [sourceType, sourceId, index, content, content.length, vectorStr]
          );
        } else {
          await client.query(
            `INSERT INTO document_chunks (source_type, source_id, chunk_index, content, char_count)
             VALUES ($1, $2, $3, $4, $5)`,
            [sourceType, sourceId, index, content, content.length]
          );
        }
      } catch (e) {
        if (e.message?.includes('embedding') || e.message?.includes('vector')) {
          await client.query(
            `INSERT INTO document_chunks (source_type, source_id, chunk_index, content, char_count)
             VALUES ($1, $2, $3, $4, $5)`,
            [sourceType, sourceId, index, content, content.length]
          );
        } else throw e;
      }
    }

    await client.query('COMMIT');
    return { indexed: chunks.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
