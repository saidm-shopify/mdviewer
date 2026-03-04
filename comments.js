/**
 * Comments Module
 * Inline selection-based comments for markdown documents
 */

const Comments = {
  _documentId: null,
  _comments: [],
  _currentUser: null,
  _pollInterval: null,
  _panel: null,
  _onUpdate: null,
  _documentMouseDownHandler: null,

  init(documentId, currentUser, panel, onUpdate) {
    this._documentId = documentId;
    this._currentUser = currentUser;
    this._panel = panel;
    this._onUpdate = onUpdate;
    this._comments = [];
  },

  async load() {
    if (!this._documentId) return [];
    this._comments = await CommentsDB.getByDocumentId(this._documentId);
    this._renderPanel();
    return this._comments;
  },

  startPolling() {
    this.stopPolling();
    this._pollInterval = setInterval(() => {
      // Pause polling when tab is hidden
      if (!document.hidden) {
        this.load();
      }
    }, 10000);
  },

  stopPolling() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  },

  /**
   * Highlight anchor texts in the preview container using TreeWalker (safe DOM manipulation).
   * Does NOT use innerHTML replacement -- preserves event listeners and mermaid SVGs.
   */
  highlightAnchors(previewContainer) {
    if (!this._comments.length) return;

    // Remove existing highlights first
    previewContainer.querySelectorAll("mark.comment-anchor").forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
    });

    const activeComments = this._comments.filter((c) => !c.resolved && c.anchorText);

    for (const comment of activeComments) {
      const walker = document.createTreeWalker(previewContainer, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const idx = node.textContent.indexOf(comment.anchorText);
        if (idx === -1) continue;

        try {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + comment.anchorText.length);

          const mark = document.createElement("mark");
          mark.className = "comment-anchor";
          mark.dataset.commentId = comment.id;
          mark.title = "Click to view comment";
          range.surroundContents(mark);

          mark.addEventListener("click", () => {
            this._scrollToComment(comment.id);
          });
        } catch (_) {
          // surroundContents can fail if range spans multiple nodes -- skip gracefully
        }
        break; // Only highlight first occurrence per comment
      }
    }
  },

  /**
   * Setup text selection handler for adding comments in preview mode
   */
  setupSelectionHandler(previewContainer) {
    let floatingBtn = document.getElementById("add-comment-btn");
    if (!floatingBtn) {
      floatingBtn = document.createElement("button");
      floatingBtn.id = "add-comment-btn";
      floatingBtn.className = "floating-comment-btn";
      floatingBtn.textContent = "Add Comment";
      floatingBtn.setAttribute("aria-label", "Add comment on selected text");
      floatingBtn.style.display = "none";
      document.body.appendChild(floatingBtn);
    }

    previewContainer.addEventListener("mouseup", (e) => {
      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text.length > 0 && text.length < 500) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        floatingBtn.style.display = "block";
        floatingBtn.style.top = `${rect.top + window.scrollY - 40}px`;
        floatingBtn.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;

        floatingBtn.onclick = () => {
          this._showCommentForm(text, previewContainer);
          floatingBtn.style.display = "none";
        };
      } else {
        floatingBtn.style.display = "none";
      }
    });

    this._documentMouseDownHandler = (e) => {
      if (e.target !== floatingBtn) {
        floatingBtn.style.display = "none";
      }
    };
    document.addEventListener("mousedown", this._documentMouseDownHandler);
  },

  _showCommentForm(anchorText, previewContainer) {
    const existing = document.getElementById("comment-form-popover");
    if (existing) existing.remove();

    const popover = document.createElement("div");
    popover.id = "comment-form-popover";
    popover.className = "comment-form-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "Add comment");
    popover.innerHTML = `
      <div class="comment-form-header">
        <span>Add Comment</span>
        <button class="comment-form-close" aria-label="Close">&times;</button>
      </div>
      <div class="comment-form-anchor">"${this._escapeHtml(anchorText.substring(0, 60))}${anchorText.length > 60 ? "..." : ""}"</div>
      <textarea class="comment-form-textarea" placeholder="Write your comment..." rows="3" aria-label="Comment text"></textarea>
      <div class="comment-form-actions">
        <button class="btn-secondary comment-form-cancel">Cancel</button>
        <button class="btn-primary comment-form-submit">Submit</button>
      </div>
    `;

    document.body.appendChild(popover);

    const textarea = popover.querySelector("textarea");
    textarea.focus();

    // Get surrounding context
    const fullText = previewContainer.textContent || "";
    const anchorIndex = fullText.indexOf(anchorText);
    const contextStart = Math.max(0, anchorIndex - 50);
    const contextEnd = Math.min(fullText.length, anchorIndex + anchorText.length + 50);
    const anchorContext = fullText.substring(contextStart, contextEnd);

    const close = () => popover.remove();

    popover.querySelector(".comment-form-close").onclick = close;
    popover.querySelector(".comment-form-cancel").onclick = close;
    popover.querySelector(".comment-form-submit").onclick = async () => {
      const body = textarea.value.trim();
      if (!body) return;

      await CommentsDB.create({
        documentId: this._documentId,
        author: this._currentUser
          ? {
              email: this._currentUser.email,
              fullName: this._currentUser.fullName,
              slackImageUrl: this._currentUser.slackImageUrl || "",
            }
          : { email: "anonymous", fullName: "Anonymous" },
        body,
        anchorText,
        anchorContext,
        resolved: false,
        resolvedBy: null,
      });

      close();
      await this.load();
      if (this._onUpdate) this._onUpdate();
    };
  },

  _renderPanel() {
    if (!this._panel) return;

    const active = this._comments.filter((c) => !c.resolved);
    const resolved = this._comments.filter((c) => c.resolved);

    this._panel.innerHTML = `
      <div class="comments-panel-header">
        <h3>Comments (${active.length})</h3>
      </div>
      <div class="comments-list">
        ${
          active.length === 0
            ? '<div class="comments-empty">No comments yet. Select text in preview mode to add a comment.</div>'
            : active
                .map(
                  (c) => `
              <div class="comment-item" data-comment-id="${this._escapeAttr(c.id)}">
                <div class="comment-meta">
                  <strong>${this._escapeHtml(c.author?.fullName || "Anonymous")}</strong>
                  <span class="comment-time">${this._timeAgo(c.created_at)}</span>
                </div>
                ${c.anchorText ? `<div class="comment-anchor-preview">"${this._escapeHtml(c.anchorText.substring(0, 80))}${c.anchorText.length > 80 ? "..." : ""}"</div>` : ""}
                <div class="comment-body">${this._escapeHtml(c.body)}</div>
                <div class="comment-actions">
                  <button class="comment-resolve-btn" data-id="${this._escapeAttr(c.id)}">Resolve</button>
                  ${c.author?.email === this._currentUser?.email ? `<button class="comment-delete-btn" data-id="${this._escapeAttr(c.id)}">Delete</button>` : ""}
                </div>
              </div>
            `
                )
                .join("")
        }
        ${
          resolved.length > 0
            ? `
          <div class="comments-resolved-section">
            <h4>Resolved (${resolved.length})</h4>
            ${resolved
              .map(
                (c) => `
                <div class="comment-item comment-resolved">
                  <div class="comment-meta">
                    <strong>${this._escapeHtml(c.author?.fullName || "Anonymous")}</strong>
                    <span class="comment-time">${this._timeAgo(c.created_at)}</span>
                  </div>
                  <div class="comment-body">${this._escapeHtml(c.body)}</div>
                </div>
              `
              )
              .join("")}
          </div>
        `
            : ""
        }
      </div>
    `;

    // Attach action handlers
    this._panel.querySelectorAll(".comment-resolve-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await CommentsDB.resolve(btn.dataset.id, this._currentUser?.email);
        await this.load();
        if (this._onUpdate) this._onUpdate();
      });
    });

    this._panel.querySelectorAll(".comment-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await CommentsDB.delete(btn.dataset.id);
        await this.load();
        if (this._onUpdate) this._onUpdate();
      });
    });
  },

  _scrollToComment(commentId) {
    if (!this._panel) return;
    const escaped = CSS.escape(commentId);
    const item = this._panel.querySelector(`.comment-item[data-comment-id="${escaped}"]`);
    if (item) {
      this._panel.classList.add("open");
      item.scrollIntoView({ behavior: "smooth", block: "center" });
      item.classList.add("comment-highlight");
      setTimeout(() => item.classList.remove("comment-highlight"), 2000);
    }
  },

  _timeAgo(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  },

  _escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },

  _escapeAttr(text) {
    return String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  },

  destroy() {
    this.stopPolling();
    this._comments = [];
    this._documentId = null;
    if (this._documentMouseDownHandler) {
      document.removeEventListener("mousedown", this._documentMouseDownHandler);
      this._documentMouseDownHandler = null;
    }
    const floatingBtn = document.getElementById("add-comment-btn");
    if (floatingBtn) floatingBtn.remove();
    const popover = document.getElementById("comment-form-popover");
    if (popover) popover.remove();
  },
};
