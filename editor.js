/**
 * Editor Module
 * Simple textarea-based markdown editor with line numbers
 */

const Editor = {
  _textarea: null,
  _container: null,
  _onChange: null,

  init(container, content, onChange) {
    this._container = container;
    this._onChange = onChange;

    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "editor-wrapper";

    const lineNumbers = document.createElement("div");
    lineNumbers.className = "editor-line-numbers";

    const textarea = document.createElement("textarea");
    textarea.className = "editor-textarea";
    textarea.value = content || "";
    textarea.spellcheck = false;
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute("autocorrect", "off");
    textarea.setAttribute("autocapitalize", "off");
    textarea.placeholder = "# Start writing markdown here...\n\nYou can use:\n- **bold** and *italic*\n- Lists, tables, code blocks\n- Mermaid diagrams (```mermaid)\n- PlantUML diagrams (```plantuml)";
    textarea.setAttribute("aria-label", "Markdown editor");

    this._textarea = textarea;

    const updateLineNumbers = () => {
      const lines = textarea.value.split("\n").length;
      lineNumbers.innerHTML = Array.from(
        { length: lines },
        (_, i) => `<div class="line-number">${i + 1}</div>`
      ).join("");
    };

    textarea.addEventListener("input", () => {
      updateLineNumbers();
      if (this._onChange) this._onChange(textarea.value);
    });

    textarea.addEventListener("scroll", () => {
      lineNumbers.scrollTop = textarea.scrollTop;
    });

    // Tab key support
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value =
          textarea.value.substring(0, start) +
          "  " +
          textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        updateLineNumbers();
        if (this._onChange) this._onChange(textarea.value);
      }
    });

    wrapper.appendChild(lineNumbers);
    wrapper.appendChild(textarea);
    container.appendChild(wrapper);

    updateLineNumbers();
    textarea.focus();
  },

  getContent() {
    return this._textarea ? this._textarea.value : "";
  },

  setContent(text) {
    if (this._textarea) {
      this._textarea.value = text;
      this._textarea.dispatchEvent(new Event("input"));
    }
  },

  destroy() {
    if (this._container) {
      this._container.innerHTML = "";
    }
    this._textarea = null;
    this._container = null;
    this._onChange = null;
  },
};
