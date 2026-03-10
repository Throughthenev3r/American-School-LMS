import React, { useState, useRef, useEffect } from "react";
import { apiFetch, API, parseJson } from "./api.js";

const WELCOME = "Hi! I'm your study assistant. Ask me about topics from your course materials. I'll give hints and guiding questions to help you think — not direct answers.";

export function ChatAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: WELCOME },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const sendMessage = async () => {
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);

    try {
      const res = await apiFetch(`${API}/ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await parseJson(res);
      if (res.ok && data?.answer) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.answer },
        ]);
      } else {
        const err = data?.error || `Request failed (${res.status})`;
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Sorry, an error occurred: ${err}` },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I couldn't connect. Check that the backend is running and OPENAI_API_KEY is set.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        className="chat-toggle"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Close assistant" : "Open study assistant"}
        aria-expanded={open}
      >
        <span className="chat-toggle-icon" aria-hidden>
          {open ? "✕" : "💬"}
        </span>
      </button>

      {/* Chat panel */}
      <div
        className={`chat-panel ${open ? "chat-panel-open" : ""}`}
        role="region"
        aria-label="Study assistant chat"
      >
        <div className="chat-header">
          <h3>Study Assistant</h3>
          <button
            type="button"
            className="chat-close"
            onClick={() => setOpen(false)}
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="chat-messages">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`chat-msg chat-msg-${m.role}`}
              data-role={m.role}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="chat-msg chat-msg-assistant chat-msg-loading">
              <span className="chat-typing" aria-hidden>● ● ●</span>
            </div>
          )}
          <div ref={messagesEndRef} className="chat-scroll-anchor" />
        </div>

        <div className="chat-input-wrap">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Ask about your course material..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
            maxLength={2000}
          />
          <button
            type="button"
            className="chat-send"
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            title="Send"
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
}
