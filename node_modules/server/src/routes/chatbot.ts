import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { processChatMessage, ChatMessage } from '../services/chatbot/llmClient.js';
import { UserContext, UserRole } from '../services/chatbot/tools.js';

export const chatbotRouter = Router();

// In-memory rate limiter: max 40 requests per minute per identifier
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 40;

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const record = rateLimits.get(identifier);
  if (!record || now > record.resetAt) {
    rateLimits.set(identifier, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  record.count += 1;
  return true;
}

/**
 * GET /api/chat/status
 * Returns LLM provider configuration status.
 */
chatbotRouter.get('/status', (_req: Request, res: Response) => {
  const provider = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || (provider === 'mock' ? 'deterministic-mock-v1' : 'default');
  const configured = provider === 'mock' || Boolean(apiKey);

  return res.json({
    configured,
    provider,
    model,
    mock_mode: provider === 'mock',
  });
});

/**
 * GET /api/chat/history
 * Fetches recent conversation messages for a session.
 */
chatbotRouter.get('/history', (req: Request, res: Response) => {
  try {
    const sessionId = (req.query.session_id as string) || 'default-session';
    const rows = db.prepare(`
      SELECT id, session_id, role, content, tool_call, tool_result, created_at
      FROM chat_messages
      WHERE session_id = ?
      ORDER BY id ASC
      LIMIT 100
    `).all(sessionId) as any[];

    const messages = rows.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      role: r.role,
      content: r.content,
      tool_call: r.tool_call ? JSON.parse(r.tool_call) : undefined,
      tool_result: r.tool_result ? JSON.parse(r.tool_result) : undefined,
      created_at: r.created_at,
    }));

    return res.json({ session_id: sessionId, count: messages.length, messages });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve chat history', message: err.message });
  }
});

/**
 * DELETE /api/chat/history
 * Clears conversation history for a session.
 */
chatbotRouter.delete('/history', (req: Request, res: Response) => {
  try {
    const sessionId = (req.query.session_id as string) || 'default-session';
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
    return res.json({ success: true, message: 'Chat history cleared' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to clear chat history', message: err.message });
  }
});

/**
 * POST /api/chat
 * Main chatbot conversation endpoint.
 */
chatbotRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { message, session_id } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    const sessionId = session_id || 'default-session';

    // 1. Rate limiting
    const clientIdentifier = (req.ip || 'client') + '_' + (req.headers['x-user-id'] || 'anon');
    if (!checkRateLimit(clientIdentifier)) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please wait a minute before sending more queries.',
      });
    }

    // 2. Extract user identity and role from headers/session
    const rawRole = ((req.headers['x-user-role'] as string) || 'hod').toLowerCase();
    const role: UserRole = ['student', 'staff', 'hod'].includes(rawRole) ? (rawRole as UserRole) : 'hod';
    const userId = (req.headers['x-user-id'] as string) || (role === 'student' ? 'STU001' : role === 'staff' ? 'STF001' : 'HOD_ADMIN');
    const sectionId = (req.headers['x-section-id'] as string) || 'CS301-A';

    const userCtx: UserContext = {
      userId,
      role,
      sectionId,
    };

    // 3. Save incoming user message to database
    db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, created_at)
      VALUES (?, 'user', ?, ?)
    `).run(sessionId, message.trim(), new Date().toISOString());

    // 4. Fetch prior history for context
    const recentRows = db.prepare(`
      SELECT role, content FROM chat_messages
      WHERE session_id = ?
      ORDER BY id DESC
      LIMIT 10
    `).all(sessionId) as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    const history: ChatMessage[] = recentRows.reverse();

    // 5. Run LLM pipeline with deterministic tool dispatch
    const response = await processChatMessage(message.trim(), history, userCtx);

    // 6. Save assistant response into database
    db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, tool_call, tool_result, created_at)
      VALUES (?, 'assistant', ?, ?, ?, ?)
    `).run(
      sessionId,
      response.reply,
      response.tool_call ? JSON.stringify(response.tool_call) : null,
      response.tool_result ? JSON.stringify(response.tool_result) : null,
      new Date().toISOString()
    );

    return res.json({
      session_id: sessionId,
      reply: response.reply,
      tool_call: response.tool_call,
      tool_result: response.tool_result,
      preview: response.preview,
      is_what_if: response.is_what_if,
      language: response.language,
      configured: response.configured,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Chatbot processing failed', message: err.message });
  }
});
