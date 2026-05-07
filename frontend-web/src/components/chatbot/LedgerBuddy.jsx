import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../shared/supabase';
// import './chatbot.css';
import './chatbot.css';
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

/* ─── SVG Icon components (inline to avoid extra deps) ─── */
const BotIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>
  </svg>
);
const SendIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>
  </svg>
);
const XIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);
const MinimizeIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
  </svg>
);
const TrashIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
  </svg>
);
const SparkleIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
  </svg>
);
const ZapIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>
  </svg>
);
const DatabaseIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>
  </svg>
);
const HistoryIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>
  </svg>
);

/**
 * LedgerBuddy — Smart Insight Chatbot with Agentic Router
 * Floating, draggable icon that opens a premium chat popup
 */
const LedgerBuddy = ({ user }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dragPos, setDragPos] = useState({ x: null, y: null });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartTime, setDragStartTime] = useState(0);
  const [hasNewMessage, setHasNewMessage] = useState(false);

  const scrollRef = useRef(null);
  const triggerRef = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const inputRef = useRef(null);

  // ─── Initialize with welcome message ──────────────────────
  useEffect(() => {
    const name = user?.email?.split('@')[0] || 'there';
    setMessages([{
      id: 'welcome',
      type: 'bot',
      text: `Hey ${name}! 👋 I'm **LedgerBuddy**, your smart financial assistant.\n\nI can answer data questions instantly from your transactions, or fetch real-time info about taxes, gold rates, and more!\n\n💡 Try asking me something below.`,
      timestamp: new Date(),
      routing: { lane: 'SYSTEM' }
    }]);
  }, [user]);

  // ─── Fetch chat history ──────────────────────────
  const fetchHistory = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${API_BASE}/api/chatbot/history`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          setMessages(prev => {
            const welcome = prev.length > 0 && prev[0].id === 'welcome' ? prev[0] : null;
            const fetched = data.map(m => ({
              ...m,
              timestamp: new Date(m.timestamp),
              routing: m.routing || { lane: 'HISTORY' }
            }));
            const combined = welcome ? [welcome, ...fetched] : fetched;
            
            // Deduplicate by id just in case
            const unique = [];
            const seen = new Set();
            for (const msg of combined) {
              if (!seen.has(msg.id)) {
                seen.add(msg.id);
                unique.push(msg);
              }
            }
            return unique;
          });
        }
      }
    } catch (err) {
      console.error('Failed to load chatbot history:', err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchHistory();
    }
  }, [user, fetchHistory]);

  // ─── Auto-scroll ───────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  // ─── Focus input when chat opens ──────────────────────────
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // ─── Drag handlers ─────────────────────────────────────────
  const onDragStart = useCallback((e) => {
    if (isOpen) return;
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    const rect = triggerRef.current.getBoundingClientRect();
    dragOffset.current = { x: clientX - rect.left, y: clientY - rect.top };
    setIsDragging(true);
    setDragStartTime(Date.now());
    e.preventDefault();
  }, [isOpen]);

  const onDragMove = useCallback((e) => {
    if (!isDragging) return;
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    const x = clientX - dragOffset.current.x;
    const y = clientY - dragOffset.current.y;
    // Clamp within viewport
    const maxX = window.innerWidth - 60;
    const maxY = window.innerHeight - 60;
    setDragPos({
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY))
    });
  }, [isDragging]);

  const onDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    // If drag lasted < 200ms and barely moved, treat as click
    if (Date.now() - dragStartTime < 200) {
      setIsOpen(true);
      setHasNewMessage(false);
    }
  }, [isDragging, dragStartTime]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);
      window.addEventListener('touchmove', onDragMove, { passive: false });
      window.addEventListener('touchend', onDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);
      window.removeEventListener('touchmove', onDragMove);
      window.removeEventListener('touchend', onDragEnd);
    };
  }, [isDragging, onDragMove, onDragEnd]);

  // ─── Send message ─────────────────────────────────────────
  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg = {
      id: `u-${Date.now()}`,
      type: 'user',
      text: trimmed,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(`${API_BASE}/api/chatbot/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ message: trimmed })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');

      setMessages(prev => [...prev, {
        id: `b-${Date.now()}`,
        type: 'bot',
        text: data.text,
        timestamp: new Date(),
        routing: data.routing || {}
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        type: 'bot',
        text: `⚠️ Error: ${err.message}. Please try again.`,
        timestamp: new Date(),
        routing: { lane: 'ERROR' }
      }]);
    } finally {
      setLoading(false);
    }
  };

  // ─── Quick action handler ─────────────────────────────────
  const handleQuickAction = (text) => {
    setInput(text);
    setTimeout(() => {
      const form = document.getElementById('lb-chat-form');
      if (form) form.requestSubmit();
    }, 50);
  };

  // ─── Clear chat ────────────────────────────────────────────
  const handleClear = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_BASE}/api/chatbot/clear`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        }
      });
      const name = user?.email?.split('@')[0] || 'there';
      setMessages([{
        id: 'welcome',
        type: 'bot',
        text: `Chat cleared! 🧹 Ready for new questions, ${name}.`,
        timestamp: new Date(),
        routing: { lane: 'SYSTEM' }
      }]);
    } catch (err) {
      console.error('Failed to clear chat:', err);
    }
  };

  // ─── Format markdown-like text ─────────────────────────────
  const formatText = (text) => {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');
  };

  // ─── Routing badge ─────────────────────────────────────────
  const RoutingBadge = ({ routing }) => {
    if (!routing || routing.lane === 'SYSTEM' || routing.lane === 'HISTORY' || routing.lane === 'ERROR' || routing.lane === 'IRRELEVANT') return null;
    const isStats = routing.lane === 'STATISTICAL';
    const isBlocked = routing.lane === 'OUT_OF_SCOPE';
    if (isBlocked) {
      return (
        <span className="lb-routing-badge blocked" title="This question is outside the scope of financial topics LedgerBuddy can help with">
          🚫 Blocked
        </span>
      );
    }
    return (
      <span className={`lb-routing-badge ${isStats ? 'stats' : 'llm'}`} title={isStats ? 'Answered instantly from your transaction data' : `Answered by AI in ${routing.latencyMs || '—'}ms`}>
        {isStats ? <DatabaseIcon /> : <ZapIcon />}
        {isStats ? 'Data' : 'AI'}
        {routing.latencyMs ? ` • ${routing.latencyMs}ms` : ''}
      </span>
    );
  };


  // ─── Quick Actions: Statistical (DB-powered) ───────────────
  const statsActions = [
    { label: 'Top spending category',         icon: '🔥' },
    { label: 'Monthly summary',               icon: '📊' },
    { label: 'Income vs expense',             icon: '💰' },
    { label: 'Largest transaction',           icon: '💸' },
    { label: 'How many bank accounts?',       icon: '🏦' },
    { label: 'Recent 5 transactions',         icon: '🧾' },
    { label: 'What are my total savings?',    icon: '📈' },
    { label: 'Average transaction amount',    icon: '🔢' },
  ];
  // ─── Quick Actions: AI / Financial Advice ──────────────────
  const llmActions = [
    { label: 'Gold rate today',               icon: '🥇' },
    { label: 'Tax saving tips',               icon: '📋' },
    { label: 'How to file ITR?',              icon: '📝' },
    { label: 'Best SIP investment tips',      icon: '💡' },
    { label: 'What is Section 80C?',          icon: '⚖️' },
    { label: 'Current Nifty 50 index',        icon: '📉' },
    { label: 'How to build emergency fund?',  icon: '🛡️' },
    { label: 'Mutual fund vs FD returns',     icon: '🏦' },
  ];

  // ─── Trigger position style ────────────────────────────────
  const triggerStyle = dragPos.x !== null
    ? { left: `${dragPos.x}px`, top: `${dragPos.y}px`, right: 'auto', bottom: 'auto' }
    : {};

  // ─── RENDER: Floating trigger ──────────────────────────────
  if (!isOpen) {
    return (
      <div
        ref={triggerRef}
        className={`lb-trigger ${isDragging ? 'dragging' : ''} ${hasNewMessage ? 'has-notification' : ''}`}
        style={triggerStyle}
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        onClick={(e) => {
          if (!isDragging) {
            setIsOpen(true);
            setHasNewMessage(false);
          }
        }}
        role="button"
        aria-label="Open LedgerBuddy Chat"
        tabIndex={0}
        id="lb-trigger-btn"
      >
        <div className="lb-trigger-glow" />
        <div className="lb-trigger-icon">
          <SparkleIcon size={22} />
        </div>
        {hasNewMessage && <span className="lb-trigger-dot" />}
      </div>
    );
  }

  // ─── RENDER: Chat panel ────────────────────────────────────
  return (
    <div className="lb-overlay" onClick={(e) => { if (e.target === e.currentTarget) setIsOpen(false); }}>
      <div className="lb-panel" id="lb-chat-panel">
        {/* ─── Header ─── */}
        <header className="lb-header">
          <div className="lb-header-left">
            <div className="lb-avatar">
              <SparkleIcon size={16} />
            </div>
            <div className="lb-header-text">
              <h3 className="lb-title">LedgerBuddy</h3>
              <span className="lb-subtitle">
                <span className="lb-status-dot" />
                Smart Insight Engine
              </span>
            </div>
          </div>
          <div className="lb-header-actions">
            <button onClick={fetchHistory} className="lb-header-btn" title="Reload your past conversation history">
              <HistoryIcon size={16} />
            </button>
            <button onClick={handleClear} className="lb-header-btn" title="Clear this conversation and start fresh">
              <TrashIcon size={14} />
            </button>
            <button onClick={() => setIsOpen(false)} className="lb-header-btn lb-close-btn" title="Minimise LedgerBuddy">
              <XIcon size={16} />
            </button>
          </div>
        </header>

        {/* ─── Messages ─── */}
        <div className="lb-messages" ref={scrollRef}>
          {messages.map((msg) => (
            <div key={msg.id} className={`lb-msg-row ${msg.type}`}>
              {msg.type === 'bot' && (
                <div className="lb-msg-avatar">
                  <BotIcon size={14} />
                </div>
              )}
              <div className="lb-msg-content">
                <div
                  className="lb-msg-bubble"
                  dangerouslySetInnerHTML={{ __html: formatText(msg.text) }}
                />
                <div className="lb-msg-meta">
                  {msg.routing && <RoutingBadge routing={msg.routing} />}
                  <span className="lb-msg-time">
                    {msg.timestamp?.toLocaleTimeString?.([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="lb-msg-row bot">
              <div className="lb-msg-avatar">
                <BotIcon size={14} />
              </div>
              <div className="lb-msg-content">
                <div className="lb-msg-bubble lb-typing">
                  <div className="lb-dot" /><div className="lb-dot" /><div className="lb-dot" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── Quick Actions ─── */}
        {messages.length <= 2 && !loading && (
          <div className="lb-quick-sections">
            <div className="lb-quick-section-label">
              <DatabaseIcon size={11} /> &nbsp;Your Data
            </div>
            <div className="lb-quick-grid">
              {statsActions.map((action, i) => (
                <button
                  key={`s-${i}`}
                  className="lb-quick-btn stats"
                  onClick={() => handleQuickAction(action.label)}
                >
                  <span className="lb-quick-icon">{action.icon}</span>
                  <span className="lb-quick-label">{action.label}</span>
                </button>
              ))}
            </div>
            <div className="lb-quick-section-label" style={{ marginTop: '8px' }}>
              <ZapIcon size={11} /> &nbsp;AI Financial Advice
            </div>
            <div className="lb-quick-grid">
              {llmActions.map((action, i) => (
                <button
                  key={`l-${i}`}
                  className="lb-quick-btn llm"
                  onClick={() => handleQuickAction(action.label)}
                >
                  <span className="lb-quick-icon">{action.icon}</span>
                  <span className="lb-quick-label">{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Input ─── */}
        <form id="lb-chat-form" className="lb-input-area" onSubmit={handleSend}>
          <input
            ref={inputRef}
            type="text"
            className="lb-input"
            placeholder="Ask anything about your finances..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            id="lb-chat-input"
          />
          <button
            type="submit"
            className="lb-send-btn"
            disabled={!input.trim() || loading}
            id="lb-send-btn"
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </div>
  );
};

export default LedgerBuddy;
