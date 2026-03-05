/**
 * Markdown Renderer Module
 * Handles markdown parsing, code highlighting, and diagram rendering
 */

const MarkdownRenderer = {
  _initialized: false,

  async init() {
    if (this._initialized) return;

    // Configure marked (highlight option removed in marked v12 -- handled in custom renderer)
    marked.setOptions({
      gfm: true,
      breaks: true,
    });

    // Custom renderer for diagram support
    const renderer = new marked.Renderer();

    // Generate heading IDs for anchor navigation (matches GFM slug format)
    renderer.heading = function (headingObj) {
      const text = typeof headingObj === "string" ? headingObj : (headingObj.text || "");
      const depth = typeof headingObj === "string" ? arguments[1] : (headingObj.depth || 1);
      const slug = text
        .toLowerCase()
        .replace(/<[^>]*>/g, "")
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim();
      return `<h${depth} id="${MarkdownRenderer._escapeAttr(slug)}">${text}</h${depth}>`;
    };

    renderer.code = function (codeObj) {
      // marked v12 passes an object { text, lang, escaped }
      const text = typeof codeObj === "string" ? codeObj : (codeObj.text || codeObj);
      const lang = typeof codeObj === "string" ? arguments[1] : (codeObj.lang || "");
      const langLower = (lang || "").toLowerCase().trim();

      // Mermaid diagrams
      if (langLower === "mermaid") {
        return `<div class="diagram-container mermaid-container"><pre class="mermaid">${MarkdownRenderer._escapeHtml(text)}</pre></div>`;
      }

      // PlantUML diagrams via Kroki (no inline onerror -- handled in postRender)
      if (["plantuml", "puml", "uml"].includes(langLower)) {
        const encoded = MarkdownRenderer._krokiEncode(text);
        return `<div class="diagram-container plantuml-container"><img src="https://kroki.io/plantuml/svg/${encoded}" alt="PlantUML Diagram" loading="lazy" data-diagram-src="${MarkdownRenderer._escapeAttr(text)}"></div>`;
      }

      // Excalidraw via Kroki
      if (langLower === "excalidraw") {
        const encoded = MarkdownRenderer._krokiEncode(text);
        return `<div class="diagram-container excalidraw-container"><img src="https://kroki.io/excalidraw/svg/${encoded}" alt="Excalidraw Diagram" loading="lazy" data-diagram-src="${MarkdownRenderer._escapeAttr(text)}"></div>`;
      }

      // ASCII art
      if (["ascii", "ascii-art", "asciiart"].includes(langLower)) {
        return `<div class="diagram-container ascii-container"><pre class="ascii-art">${MarkdownRenderer._escapeHtml(text)}</pre></div>`;
      }

      // Default: syntax-highlighted code block
      if (typeof hljs !== "undefined") {
        if (lang && hljs.getLanguage(lang)) {
          try {
            const highlighted = hljs.highlight(text, { language: lang }).value;
            return `<pre><code class="hljs language-${MarkdownRenderer._escapeAttr(lang)}">${highlighted}</code></pre>`;
          } catch (_) {}
        }
        try {
          const autoHighlighted = hljs.highlightAuto(text).value;
          return `<pre><code class="hljs">${autoHighlighted}</code></pre>`;
        } catch (_) {}
      }
      return `<pre><code>${MarkdownRenderer._escapeHtml(text)}</code></pre>`;
    };

    marked.use({ renderer });

    // Initialize mermaid with strict security
    if (typeof mermaid !== "undefined") {
      const isDark = document.documentElement.getAttribute("data-theme") !== "light";
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        securityLevel: "strict",
      });
    }

    this._initialized = true;
  },

  /**
   * Render markdown to sanitized HTML
   */
  render(source) {
    if (!source) return "";
    const rawHtml = marked.parse(source);
    return DOMPurify.sanitize(rawHtml, {
      ADD_TAGS: ["pre", "code", "img", "mark"],
      ADD_ATTR: [
        "class",
        "id",
        "href",
        "data-comment-id",
        "data-diagram-src",
        "loading",
        "alt",
        "src",
      ],
    });
  },

  /**
   * Post-render: trigger mermaid rendering + attach diagram error handlers
   */
  async postRender(container) {
    // Mermaid
    if (typeof mermaid !== "undefined") {
      try {
        const mermaidEls = container.querySelectorAll("pre.mermaid");
        if (mermaidEls.length > 0) {
          await mermaid.run({ nodes: mermaidEls });
        }
      } catch (error) {
        console.error("Mermaid rendering error:", error);
      }
    }

    // Diagram image error fallback (replaces inline onerror)
    container.querySelectorAll(".diagram-container img[data-diagram-src]").forEach((img) => {
      img.addEventListener("error", () => {
        const src = img.dataset.diagramSrc || "";
        img.parentElement.innerHTML = `<pre class="diagram-fallback">${this._escapeHtml(src)}</pre>`;
      }, { once: true });
    });
  },

  /**
   * Encode text for Kroki API (deflate + base64url) -- safe for any size
   */
  _krokiEncode(text) {
    try {
      const data = new TextEncoder().encode(text);
      const compressed = pako.deflate(data, { level: 9 });
      // Chunked conversion to avoid call stack overflow
      let binary = "";
      for (let i = 0; i < compressed.length; i++) {
        binary += String.fromCharCode(compressed[i]);
      }
      const base64 = btoa(binary);
      return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    } catch (error) {
      console.error("Kroki encoding error:", error);
      return "";
    }
  },

  _escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },

  _escapeAttr(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  },
};
