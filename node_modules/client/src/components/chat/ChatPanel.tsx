import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Info,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  sendChatMessage,
  fetchChatHistory,
  clearChatHistory,
  confirmManagementChange,
  discardManagementChange,
  ChatMessageItem,
  getStoredUserRole,
  getStoredLanguage,
} from '../../lib/api';
import { I18N_STRINGS } from '../../lib/i18n';

interface ChatPanelProps {
  isDrawer?: boolean;
  onCloseDrawer?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ isDrawer, onCloseDrawer }) => {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const role = getStoredUserRole();
  const lang = getStoredLanguage();
  const t = I18N_STRINGS[lang];

  const sessionId = 'smart-timetable-chat-session';

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadHistory = async () => {
    try {
      const history = await fetchChatHistory(sessionId);
      if (history.length > 0) {
        setMessages(history);
      } else {
        // Welcome message
        setMessages([
          {
            role: 'assistant',
            content:
              lang === 'ta'
                ? 'வணக்கம்! நான் உங்கள் ஸ்மார்ட் கால அட்டவணை உதவியாளர். காலியான அறைகள், ஆசிரியர்களின் ஓய்வு நேரம், மணிநேர நிலவரம், அல்லது மாதிரி உருவகப்படுத்துதல்களை (What-if) என்னிடம் கேட்கலாம்.'
                : 'Hello! I am your Smart Timetable Assistant. You can ask me to find free rooms, inspect faculty schedules, analyze hours shortfall, or simulate "what-if" management changes.',
          },
        ]);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    setInput('');
    const userMsg: ChatMessageItem = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await sendChatMessage(text, sessionId);
      const assistantMsg: ChatMessageItem = {
        role: 'assistant',
        content: res.reply,
        tool_call: res.tool_call,
        tool_result: res.tool_result,
        preview: res.preview,
        is_what_if: res.is_what_if,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      toast.error(err.message || 'Chat request failed');
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err.message || 'Could not reach assistant server.'}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    try {
      await clearChatHistory(sessionId);
      setMessages([
        {
          role: 'assistant',
          content: lang === 'ta' ? 'உரையாடல் அழிக்கப்பட்டது.' : 'Conversation cleared.',
        },
      ]);
      toast.info('Chat history cleared');
    } catch (err: any) {
      toast.error(err.message || 'Failed to clear chat');
    }
  };

  const toggleToolDetails = (index: number) => {
    setExpandedTools((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleConfirmPreview = async (changeId: number, msgIndex: number) => {
    setConfirmingId(changeId);
    try {
      await confirmManagementChange(changeId);
      toast.success('Change confirmed and applied to live timetable!');
      // Update message state
      setMessages((prev) => {
        const next = [...prev];
        if (next[msgIndex]?.preview) {
          next[msgIndex] = {
            ...next[msgIndex],
            preview: {
              ...next[msgIndex].preview!,
              status: 'applied',
            },
          };
        }
        return next;
      });
    } catch (err: any) {
      toast.error(err.message || 'Confirmation failed');
    } finally {
      setConfirmingId(null);
    }
  };

  const handleDiscardPreview = async (changeId: number, msgIndex: number) => {
    setConfirmingId(changeId);
    try {
      await discardManagementChange(changeId);
      toast.info('Preview discarded.');
      setMessages((prev) => {
        const next = [...prev];
        if (next[msgIndex]?.preview) {
          next[msgIndex] = {
            ...next[msgIndex],
            preview: {
              ...next[msgIndex].preview!,
              status: 'discarded',
            },
          };
        }
        return next;
      });
    } catch (err: any) {
      toast.error(err.message || 'Discard failed');
    } finally {
      setConfirmingId(null);
    }
  };

  const suggestionChips = [
    'Which rooms are free on Tuesday period 3?',
    'Who is free Tuesday period 3?',
    'Hours left for CS301',
    'What if Staff STF001 is on leave next week?',
    'Give me timetable insights',
    'செவ்வாய்க்கிழமை பீரியட் 3 இல் காலியான அறைகள் எவை?',
  ];

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              {t.assistantTitle}
              <span className="text-[10px] bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 font-semibold px-1.5 py-0.2 rounded">
                Live
              </span>
            </h2>
            <p className="text-[11px] text-gray-500">
              Role: <strong className="uppercase text-indigo-600">{role}</strong> • Deterministic tools only
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleClear}
            title={t.clearChat}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {isDrawer && onCloseDrawer && (
            <button
              onClick={onCloseDrawer}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs font-semibold"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 p-5 overflow-y-auto space-y-4">
        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          return (
            <div key={idx} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div className={`max-w-[85%] space-y-2 ${isUser ? 'items-end' : 'items-start'}`}>
                {/* Message Bubble */}
                <div
                  className={`p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                    isUser
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>

                {/* Collapsible "How I got this" Tool Pill */}
                {msg.tool_call && (
                  <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/60 rounded-xl overflow-hidden text-xs">
                    <button
                      onClick={() => toggleToolDetails(idx)}
                      className="w-full px-3 py-1.5 flex items-center justify-between text-gray-600 dark:text-gray-300 hover:bg-gray-100/50 dark:hover:bg-gray-800 font-medium"
                    >
                      <span className="flex items-center gap-1.5 font-mono text-[11px]">
                        <Sparkles className="w-3 h-3 text-indigo-500" />
                        Tool: <strong>{msg.tool_call.name}</strong>
                      </span>
                      {expandedTools[idx] ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {expandedTools[idx] && (
                      <div className="p-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 text-[11px] font-mono space-y-2">
                        <div>
                          <span className="text-gray-400 block font-semibold mb-0.5">Arguments:</span>
                          <pre className="bg-gray-50 dark:bg-gray-950 p-2 rounded text-gray-700 dark:text-gray-300 overflow-x-auto">
                            {JSON.stringify(msg.tool_call.arguments, null, 2)}
                          </pre>
                        </div>
                        {msg.tool_result && (
                          <div>
                            <span className="text-gray-400 block font-semibold mb-0.5">Result:</span>
                            <pre className="bg-gray-50 dark:bg-gray-950 p-2 rounded text-gray-700 dark:text-gray-300 overflow-x-auto max-h-32">
                              {JSON.stringify(msg.tool_result, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Action Preview Card (Mandatory Preview -> Confirm Flow) */}
                {msg.preview && (
                  <div className="p-4 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-2xl text-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                        <Info className="w-3.5 h-3.5 text-amber-600" />
                        {msg.is_what_if ? 'What-if Simulation' : 'Change Preview'}
                      </span>
                      <span className="text-[10px] bg-amber-200/80 text-amber-900 dark:bg-amber-900 dark:text-amber-200 px-2 py-0.5 rounded font-semibold uppercase">
                        {msg.preview.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-white/80 dark:bg-gray-900/80 p-2 rounded-lg border border-amber-200/60 dark:border-amber-900/40">
                        <span className="text-gray-500 text-[10px] block">Affected Sessions</span>
                        <strong className="text-sm text-gray-900 dark:text-white">
                          {msg.preview.impact_summary.sessions_affected_count}
                        </strong>
                      </div>
                      <div className="bg-white/80 dark:bg-gray-900/80 p-2 rounded-lg border border-amber-200/60 dark:border-amber-900/40">
                        <span className="text-gray-500 text-[10px] block">Clashes</span>
                        <strong className="text-sm text-green-600">
                          {msg.preview.impact_summary.new_clashes}
                        </strong>
                      </div>
                      <div className="bg-white/80 dark:bg-gray-900/80 p-2 rounded-lg border border-amber-200/60 dark:border-amber-900/40">
                        <span className="text-gray-500 text-[10px] block">Shortfall</span>
                        <strong className="text-sm text-indigo-600">
                          {msg.preview.impact_summary.shortfall_before}h → {msg.preview.impact_summary.shortfall_after}h
                        </strong>
                      </div>
                    </div>

                    {/* Diff lines snippet */}
                    {msg.preview.impact_summary.diff.length > 0 && (
                      <div className="bg-white/90 dark:bg-gray-900/90 rounded-lg p-2.5 border border-amber-200/60 dark:border-amber-900/40 space-y-1">
                        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block">
                          Displaced Moves
                        </span>
                        {msg.preview.impact_summary.diff.slice(0, 3).map((d, i) => (
                          <div key={i} className="text-[11px] text-gray-700 dark:text-gray-300">
                            • {d.description}: <span className="font-mono text-green-600">{d.after}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Confirmation Rule: Chatbot never applies change automatically. UI button is mandatory. */}
                    {!msg.is_what_if && msg.preview.change_id && msg.preview.status === 'previewed' && (
                      <div className="pt-2 flex items-center justify-end gap-2 border-t border-amber-200/60 dark:border-amber-900/40">
                        <button
                          onClick={() => handleDiscardPreview(msg.preview!.change_id!, idx)}
                          disabled={confirmingId === msg.preview.change_id}
                          className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white rounded-lg hover:bg-amber-100/60"
                        >
                          Discard
                        </button>
                        <button
                          onClick={() => handleConfirmPreview(msg.preview!.change_id!, idx)}
                          disabled={confirmingId === msg.preview.change_id}
                          className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Confirm & Apply
                        </button>
                      </div>
                    )}

                    {msg.preview.status === 'applied' && (
                      <div className="text-[11px] text-green-700 dark:text-green-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Successfully committed to timetable.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {isUser && (
                <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5 text-xs">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div className="flex gap-3 items-center text-gray-400 text-xs">
            <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
            <span>Evaluating rules and solver state...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion Chips */}
      <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800/60 flex items-center gap-2 overflow-x-auto bg-gray-50/40 dark:bg-gray-900/40 text-xs no-scrollbar">
        {suggestionChips.map((chip, i) => (
          <button
            key={i}
            onClick={() => handleSend(chip)}
            className="px-2.5 py-1 bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 hover:text-indigo-600 text-gray-600 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-700 shrink-0 transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.typeMessagePlaceholder}
            disabled={loading}
            className="flex-1 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl disabled:opacity-50 transition-colors shadow-sm"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
export default ChatPanel;
