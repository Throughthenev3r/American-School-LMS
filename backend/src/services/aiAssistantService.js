/**
 * AI Assistant: intent classification, RAG, and response.
 * Classifies intent before answering; only question_about_material triggers RAG + LLM.
 */
import { searchRelevantChunks } from './chunkSearchService.js';

/** Supported intents for classification */
export const INTENTS = Object.freeze({
  QUESTION_ABOUT_MATERIAL: 'question_about_material',
  GRATITUDE: 'gratitude',
  GREETING: 'greeting',
  GOODBYE: 'goodbye',
  ACKNOWLEDGEMENT: 'acknowledgement',
});

/** Normalized text for intent matching (lowercase, punctuation removed, collapsed spaces) */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pattern sets: one match in the set => that intent (order: greeting, goodbye, gratitude, then question) */
const GREETING_PATTERNS = [
  'hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening',
  'привет', 'здравствуй', 'здравствуйте', 'добрый день', 'доброе утро', 'добрый вечер',
  'хай', 'здарова', 'салют', 'hi there', 'hello there',
];
const GOODBYE_PATTERNS = [
  'bye', 'goodbye', 'good bye', 'see you', 'see ya', 'later', 'have a good one',
  'пока', 'до свидания', 'до встречи', 'всего хорошего', 'удачи', 'бывай', 'прощай',
];
const GRATITUDE_PATTERNS = [
  'thanks', 'thank you', 'thank u', 'thx', 'thanks a lot', 'many thanks', 'ty',
  'спасибо', 'благодарю', 'благодарствую', 'мерси', 'пасиб', 'пасибо',
];
const ACKNOWLEDGEMENT_PATTERNS = [
  'ok', 'okay', 'got it', 'gotcha', 'sure', 'alright', 'understood',
  'понятно', 'понял', 'ясно', 'ок', 'ага', 'хорошо', 'принято',
];

/**
 * Classifies user message into one of INTENTS.
 * Rule-based for speed and predictability; defaults to question_about_material.
 * @param {string} question - Raw user message
 * @returns {string} One of INTENTS values
 */
export function classifyIntent(question) {
  const t = normalize(question);
  if (!t) return INTENTS.QUESTION_ABOUT_MATERIAL;

  const words = t.split(' ').filter(Boolean);
  const firstWord = words[0] || '';
  const lastWord = words[words.length - 1] || '';

  for (const p of GREETING_PATTERNS) {
    if (t === p || t.startsWith(p + ' ') || firstWord === p) return INTENTS.GREETING;
  }
  for (const p of GOODBYE_PATTERNS) {
    if (t === p || t.endsWith(' ' + p) || lastWord === p || t.startsWith(p + ' ')) return INTENTS.GOODBYE;
  }
  for (const p of GRATITUDE_PATTERNS) {
    if (t === p || t.startsWith(p + ' ') || t.endsWith(' ' + p) || t.includes(' ' + p + ' ') || t.startsWith(p)) return INTENTS.GRATITUDE;
  }
  for (const p of ACKNOWLEDGEMENT_PATTERNS) {
    if (t === p || t.startsWith(p + ' ') || t.endsWith(' ' + p) || firstWord === p) return INTENTS.ACKNOWLEDGEMENT;
  }

  return INTENTS.QUESTION_ABOUT_MATERIAL;
}

/** Short replies for greeting/thanks/acknowledgement — brief, no excerpts */
const SHORT_REPLIES = Object.freeze({
  [INTENTS.GREETING]: "Hi! Ask me about your course materials and I'll point you where to look.",
  [INTENTS.GOODBYE]: "Bye! Good luck with your studies.",
  [INTENTS.GRATITUDE]: "You're welcome.",
  [INTENTS.ACKNOWLEDGEMENT]: "Got it. Ask if you need help finding something.",
});

const SYSTEM_PROMPT = [
  'You are a study assistant. Help students find answers in their course materials.',
  '',
  'Rules:',
  '1. Help students find answers in course materials.',
  '2. Guide students to the exact place - assignment name, file name, and excerpt number - so they can locate it.',
  '3. Do NOT give direct answers. Only guide where to look.',
  '4. Keep responses short (1-2 sentences).',
  '5. If no relevant material is found, suggest they review the materials or ask their teacher.',
  "6. Respond in the same language as the student's question.",
].join('\n');

function buildUserPrompt(question, chunks) {
  if (!chunks || chunks.length === 0) {
    return 'Student question: ' + question + '\n\n(No relevant excerpts found. Suggest the student review the materials or ask their teacher.)';
  }
  const formatExcerpt = (c, i) => {
    const loc = [c.assignment_title, c.file_name].filter(Boolean).join(', ');
    const header = loc ? '[Excerpt ' + (i + 1) + ' | ' + loc + ']\n' : '[Excerpt ' + (i + 1) + ']\n';
    return header + c.content;
  };
  const excerpts = chunks.map(formatExcerpt).join('\n\n');
  return 'Student question: ' + question + '\n\nRelevant material excerpts (with exact location):\n\n' + excerpts + '\n\nBased on these excerpts, point the student to the exact place (assignment, file, excerpt). Do NOT give the direct answer.';
}

/**
 * Calls Claude (Anthropic) API.
 */
async function callClaude(apiKey, model, question, chunks) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });
  const userPrompt = buildUserPrompt(question, chunks);

  const message = await client.messages.create({
    model: model || 'claude-3-5-sonnet-20241022',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const block = message.content?.find((b) => b.type === 'text');
  const text = block?.text?.trim();
  if (!text) throw new Error('Empty response from Claude');
  return text;
}

/**
 * Calls OpenAI-compatible API (OpenAI, Azure, etc.) to generate tutor response.
 */
async function callOpenAI(opts, question, chunks) {
  const { apiKey, baseURL, model } = opts;
  const modelToUse = model || 'gpt-4o-mini';
  const OpenAI = (await import('openai')).default;
  const clientConfig = { apiKey };
  if (baseURL) clientConfig.baseURL = baseURL;
  const client = new OpenAI(clientConfig);
  const userPrompt = buildUserPrompt(question, chunks);

  const completion = await client.chat.completions.create({
    model: modelToUse,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 500,
    temperature: 0.5,
  });

  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response from AI');
  return text;
}

/**
 * Calls LLM: OpenAI if OPENAI_API_KEY set, else Claude if ANTHROPIC_API_KEY set.
 */
async function callLLM(opts, question, chunks) {
  const { anthropicApiKey, anthropicModel, apiKey, baseURL, model } = opts;
  if (apiKey) return callOpenAI({ apiKey, baseURL, model }, question, chunks);
  if (anthropicApiKey) return callClaude(anthropicApiKey, anthropicModel, question, chunks);
  throw new Error('AI API key not configured (OPENAI_API_KEY or ANTHROPIC_API_KEY)');
}

/**
 * Extracts simple topics/keywords from the question for analytics.
 * @param {string} question
 * @returns {string[]}
 */
function extractTopics(question) {
  const stop = new Set(['the', 'a', 'an', 'is', 'are', 'how', 'what', 'why', 'when', 'where', 'can', 'do', 'does', 'i', 'me', 'my', 'please', 'help']);
  const words = String(question || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  return [...new Set(words)].slice(0, 10);
}

/**
 * Full pipeline: classify intent → if question_about_material run RAG + LLM, else short reply → log.
 * @param {object} pool - pg Pool
 * @param {object} opts - { question, studentId, apiKey?, anthropicApiKey?, anthropicModel?, baseURL?, model? }
 * @returns {Promise<{ answer, intent, chunkIds, topics }>}
 */
export async function askAssistant(pool, { question, studentId, apiKey, anthropicApiKey, anthropicModel, baseURL, model }) {
  const intent = classifyIntent(question);

  if (intent !== INTENTS.QUESTION_ABOUT_MATERIAL) {
    const answer = SHORT_REPLIES[intent] ?? SHORT_REPLIES[INTENTS.GRATITUDE];
    await pool.query(
      `INSERT INTO ai_ask_log (student_id, question, answer_summary, chunk_ids, topics, intent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [studentId, question, answer, [], [], intent]
    );
    return { answer, intent, chunkIds: [], topics: [] };
  }

  const chunks = await searchRelevantChunks(pool, question, studentId);
  const answer = await callLLM(
    { apiKey, baseURL, model, anthropicApiKey, anthropicModel },
    question,
    chunks
  );
  const topics = extractTopics(question);
  const chunkIds = chunks.map((c) => c.id);

  await pool.query(
    `INSERT INTO ai_ask_log (student_id, question, answer_summary, chunk_ids, topics, intent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [studentId, question, answer.slice(0, 2000), chunkIds, topics, intent]
  );

  return { answer, intent, chunkIds, topics };
}
