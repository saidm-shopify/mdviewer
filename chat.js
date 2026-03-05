/**
 * Chat Module
 * AI-powered Q&A that searches across all user's markdown documents.
 * Uses quick.ai.chat() with document content as context.
 */

const Chat = {
  _messages: [],
  _panel: null,
  _isOpen: false,
  _isLoading: false,

  /**
   * Initialize the chat UI: floating button + panel.
   * Call once at app boot.
   */
  init() {
    // Floating toggle button
    const btn = document.createElement("button");
    btn.id = "chat-toggle-btn";
    btn.className = "chat-toggle-btn";
    btn.innerHTML = `<span class="chat-toggle-icon">&#128172;</span>`;
    btn.title = "Ask AI about your documents";
    btn.setAttribute("aria-label", "Open AI chat");
    btn.addEventListener("click", () => this.toggle());
    document.body.appendChild(btn);

    // Chat panel
    const panel = document.createElement("div");
    panel.id = "chat-panel";
    panel.className = "chat-panel";
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "AI Chat");
    panel.innerHTML = `
      <div class="chat-header">
        <span class="chat-header-title">Ask your docs</span>
        <button class="chat-header-close" title="Close">&times;</button>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="chat-welcome">
          <p><strong>Ask anything about your documents.</strong></p>
          <p>I'll search across all your .md files and answer based on their content.</p>
        </div>
      </div>
      <div class="chat-input-row">
        <textarea id="chat-input" class="chat-input" placeholder="Ask a question..." rows="1" aria-label="Ask a question about your documents"></textarea>
        <button id="chat-send-btn" class="chat-send-btn" title="Send">&#9654;</button>
      </div>
    `;
    document.body.appendChild(panel);
    this._panel = panel;

    // Wire close button
    panel.querySelector(".chat-header-close").addEventListener("click", () => this.close());

    // Wire send
    const input = document.getElementById("chat-input");
    const sendBtn = document.getElementById("chat-send-btn");

    sendBtn.addEventListener("click", () => this._send());

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this._send();
      }
    });

    // Auto-resize textarea
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
  },

  toggle() {
    if (this._isOpen) this.close();
    else this.open();
  },

  open() {
    this._isOpen = true;
    this._panel.classList.add("chat-panel-open");
    document.getElementById("chat-toggle-btn").classList.add("chat-toggle-active");
    document.getElementById("chat-input").focus();
  },

  close() {
    this._isOpen = false;
    this._panel.classList.remove("chat-panel-open");
    document.getElementById("chat-toggle-btn").classList.remove("chat-toggle-active");
  },

  /**
   * Send user's question to the AI with document context.
   */
  async _send() {
    const input = document.getElementById("chat-input");
    const question = input.value.trim();
    if (!question || this._isLoading) return;

    input.value = "";
    input.style.height = "auto";

    // Add user message to UI
    this._appendMessage("user", question);

    this._isLoading = true;
    this._showTyping();

    try {
      // Build context from all user documents
      const context = await this._buildContext();

      // Build messages for the LLM
      const systemPrompt = `You are a helpful assistant that answers questions based on the user's markdown documents.
You have access to the following documents:

${context}

Instructions:
- Answer the user's question based ONLY on the content of these documents.
- If the answer is found in a specific document, mention the document title.
- If the information is not in any document, say so clearly.
- Keep answers concise and direct.
- You can quote relevant sections from the documents.
- Format your response in markdown.`;

      this._messages.push({ role: "user", content: question });

      // Keep only last 10 messages to avoid exceeding LLM context limits
      const recentMessages = this._messages.slice(-10);
      const messagesForApi = [
        { role: "system", content: systemPrompt },
        ...recentMessages,
      ];

      let answer;
      if (typeof quick !== "undefined" && quick.ai && quick.ai.chat) {
        const response = await quick.ai.chat(messagesForApi, {
          model: "gpt-4o",
          temperature: 0.3,
          max_tokens: 1000,
        });
        answer = response?.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";
      } else {
        // Local dev fallback
        answer = this._localFallback(question, context);
      }

      this._messages.push({ role: "assistant", content: answer });
      this._removeTyping();
      this._appendMessage("assistant", answer);
    } catch (error) {
      console.error("Chat error:", error);
      this._removeTyping();
      this._appendMessage("assistant", "Sorry, something went wrong. Please try again.");
    }

    this._isLoading = false;
  },

  /**
   * Build context string from all user documents.
   * Truncates each doc to keep total context manageable.
   */
  async _buildContext() {
    const docs = await DocumentsDB.getAll();
    if (docs.length === 0) {
      return "(No documents found. The user has not uploaded any markdown files yet.)";
    }

    const MAX_CHARS_PER_DOC = 3000;
    const MAX_TOTAL_CHARS = 20000;
    let totalChars = 0;

    const parts = [];
    for (const doc of docs) {
      if (totalChars >= MAX_TOTAL_CHARS) {
        parts.push(`\n--- Document: "${doc.title}" ---\n(Truncated - document too large to include)`);
        continue;
      }

      let content = doc.content || "";
      const remaining = MAX_TOTAL_CHARS - totalChars;
      const limit = Math.min(MAX_CHARS_PER_DOC, remaining);

      if (content.length > limit) {
        content = content.substring(0, limit) + "\n...(truncated)";
      }

      parts.push(`\n--- Document: "${doc.title}" ---\n${content}`);
      totalChars += content.length;
    }

    return parts.join("\n");
  },

  /**
   * Fallback for local dev without quick.ai
   */
  _localFallback(question, context) {
    const qLower = question.toLowerCase();
    const lines = context.split("\n");
    const matches = [];

    for (const line of lines) {
      if (line.toLowerCase().includes(qLower) ||
          qLower.split(/\s+/).some((word) => word.length > 2 && line.toLowerCase().includes(word))) {
        matches.push(line.trim());
      }
    }

    if (matches.length > 0) {
      return `**Local search results** (quick.ai not available):\n\n${matches.slice(0, 10).map((m) => `- ${m}`).join("\n")}`;
    }
    return "No matches found in your documents. (Note: running locally without quick.ai - only basic keyword search is available.)";
  },

  /**
   * Append a message bubble to the chat UI.
   */
  _appendMessage(role, content) {
    const container = document.getElementById("chat-messages");
    const welcome = container.querySelector(".chat-welcome");
    if (welcome) welcome.remove();

    const bubble = document.createElement("div");
    bubble.className = `chat-bubble chat-bubble-${role}`;

    if (role === "assistant") {
      // Render markdown in assistant responses
      const html = typeof marked !== "undefined"
        ? DOMPurify.sanitize(marked.parse(content))
        : this._escapeHtml(content);
      bubble.innerHTML = html;
    } else {
      bubble.textContent = content;
    }

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  },

  _showTyping() {
    const container = document.getElementById("chat-messages");
    const typing = document.createElement("div");
    typing.className = "chat-bubble chat-bubble-assistant chat-typing";
    typing.id = "chat-typing";
    typing.innerHTML = `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>`;
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
  },

  _removeTyping() {
    const el = document.getElementById("chat-typing");
    if (el) el.remove();
  },

  _escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },
};
