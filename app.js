/**
 * Markdown Viewer - Main Application
 * Orchestrates routing, identity, document CRUD, and module wiring
 */

// State
let currentUser = null;
let currentDoc = null;
let currentMode = "preview"; // 'preview' | 'edit'
let autoSaveTimer = null;
let currentZoom = 1;
let isOwner = false;
let isSaving = false;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// ── Initialization ──────────────────────────────────────────────────────

async function initApp() {
  applyInitialTheme();
  showLoading(true);

  // Load user identity
  try {
    currentUser = await quick.id.waitForUser();
  } catch (e) {
    console.log("Running without user identity");
    currentUser = { email: "anonymous", fullName: "Anonymous" };
  }

  // Scope database to current user
  DocumentsDB.setUser(currentUser.email);

  // Init markdown renderer
  await MarkdownRenderer.init();

  // Setup keyboard shortcuts
  document.addEventListener("keydown", handleKeyboardShortcut);

  // Setup drag and drop on the whole page
  setupGlobalDragDrop();

  // Init AI chat
  Chat.init();

  // Route
  handleRoute();
  window.addEventListener("hashchange", handleRoute);

  showLoading(false);
}

// ── Routing ─────────────────────────────────────────────────────────────

function handleRoute() {
  const hash = window.location.hash || "#/";

  // Save any pending editor content before routing away
  if (currentDoc && currentMode === "edit" && Editor._textarea) {
    currentDoc.content = Editor.getContent();
  }

  // Cleanup previous state
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  Comments.destroy();
  Editor.destroy();
  destroyPreviewZoom();

  if (hash === "#/" || hash === "#" || hash === "") {
    renderHomePage();
  } else if (hash === "#/new") {
    renderNewDocPage();
  } else if (hash.startsWith("#/doc/")) {
    const parts = hash.substring(6).split("/");
    const slug = parts[0];
    const mode = parts[1] || "preview";
    renderDocPage(slug, mode);
  } else {
    renderHomePage();
  }
}

// ── Home Page ───────────────────────────────────────────────────────────

async function renderHomePage() {
  const main = document.getElementById("main-content");
  const toolbar = document.getElementById("toolbar");

  toolbar.innerHTML = `
    <div class="toolbar-left">
      <h1 class="toolbar-title">🧠 MarkdownMind</h1>
    </div>
    <div class="toolbar-right">
      <button id="btn-new" class="btn-primary">+ New Document</button>
      <button id="btn-upload" class="btn-secondary">Upload .md</button>
      <input type="file" id="file-upload-input" accept=".md,.markdown,.txt" multiple style="display:none" aria-label="Upload markdown files">
      <button id="btn-theme" class="btn-icon" title="Toggle theme" aria-label="Toggle theme">${getThemeIcon()}</button>
    </div>
  `;

  main.innerHTML = `
    <div class="home-page">
      <div class="search-bar">
        <input type="text" id="search-input" class="search-input" placeholder="Search documents by title or content..." autocomplete="off" aria-label="Search documents">
        <div id="search-results-count" class="search-results-count" aria-live="polite"></div>
      </div>

      <div id="drop-zone" class="drop-zone" role="button" tabindex="0" aria-label="Drop markdown files here to upload">
        <div class="drop-zone-content">
          <div class="drop-zone-icon" aria-hidden="true">&#128196;</div>
          <p class="drop-zone-text">Drag & drop .md files here</p>
          <p class="drop-zone-subtext">or use the buttons above to create or upload</p>
        </div>
      </div>

      <div id="docs-grid" class="docs-grid" role="list">
      </div>

      <div id="empty-state" class="empty-state" style="display:none">
        <p>No documents found</p>
        <p class="empty-subtitle">Drop a .md file or create a new document to get started.</p>
      </div>
    </div>
  `;

  // Wire up buttons
  document.getElementById("btn-new").addEventListener("click", () => {
    window.location.hash = "#/new";
  });

  const fileInput = document.getElementById("file-upload-input");
  document.getElementById("btn-upload").addEventListener("click", () => {
    fileInput.click();
  });
  fileInput.addEventListener("change", (e) => handleFileUpload(e.target.files));

  document.getElementById("btn-theme").addEventListener("click", () => {
    toggleTheme();
    document.getElementById("btn-theme").innerHTML = getThemeIcon();
  });

  // Setup search
  const searchInput = document.getElementById("search-input");
  let searchDebounce = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      loadDocumentsList(searchInput.value);
    }, 300);
  });

  // Setup drag-and-drop zone
  setupDropZone(document.getElementById("drop-zone"));

  // Load documents
  await loadDocumentsList();
}

async function loadDocumentsList(query = "") {
  const grid = document.getElementById("docs-grid");
  const emptyState = document.getElementById("empty-state");
  const dropZone = document.getElementById("drop-zone");
  const resultsCount = document.getElementById("search-results-count");

  // Guard against navigation race (DOM elements may be gone)
  if (!grid || !emptyState) return;

  let docs;
  if (query && query.trim()) {
    docs = await DocumentsDB.search(query);
    if (resultsCount) resultsCount.textContent = `${docs.length} result${docs.length !== 1 ? "s" : ""} for "${query}"`;
  } else {
    docs = await DocumentsDB.getAll();
    if (resultsCount) resultsCount.textContent = "";
  }

  // Sort by most recently updated
  docs.sort(
    (a, b) =>
      new Date(b.updated_at || b.created_at) -
      new Date(a.updated_at || a.created_at)
  );

  if (docs.length === 0) {
    grid.innerHTML = "";
    emptyState.style.display = "block";
    if (dropZone) dropZone.style.display = !query ? "flex" : "none";
    return;
  }

  emptyState.style.display = "none";
  if (dropZone) dropZone.style.display = docs.length < 3 ? "flex" : "none";

  grid.innerHTML = docs
    .map((doc) => {
      const preview = (doc.content || "")
        .replace(/[#*`>\-\[\]()!]/g, "")
        .substring(0, 150);
      const date = new Date(
        doc.updated_at || doc.created_at
      ).toLocaleDateString();
      return `
        <div class="doc-card" data-slug="${escapeAttr(doc.slug)}" role="listitem" tabindex="0">
          <div class="doc-card-header">
            <h3 class="doc-card-title">${escapeHtml(doc.title || "Untitled")}</h3>
            <div class="doc-card-actions">
              <button class="doc-card-delete" data-id="${escapeAttr(doc.id)}" title="Delete" aria-label="Delete ${escapeAttr(doc.title || "document")}">&times;</button>
            </div>
          </div>
          <p class="doc-card-preview">${escapeHtml(preview)}${preview.length >= 150 ? "..." : ""}</p>
          <div class="doc-card-meta">
            <span>${date}</span>
            <span>${escapeHtml(doc.owner?.fullName || "")}</span>
          </div>
        </div>
      `;
    })
    .join("");

  // Card click + keyboard -> open doc
  grid.querySelectorAll(".doc-card").forEach((card) => {
    const openDoc = () => {
      window.location.hash = `#/doc/${card.dataset.slug}`;
    };
    card.addEventListener("click", (e) => {
      if (e.target.classList.contains("doc-card-delete")) return;
      openDoc();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDoc();
      }
    });
  });

  // Delete buttons
  grid.querySelectorAll(".doc-card-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this document?")) return;
      await DocumentsDB.delete(btn.dataset.id);
      await loadDocumentsList(
        document.getElementById("search-input")?.value || ""
      );
    });
  });
}

// ── New Document Page ───────────────────────────────────────────────────

function renderNewDocPage() {
  currentDoc = null;
  currentMode = "edit";

  const toolbar = document.getElementById("toolbar");
  toolbar.innerHTML = `
    <div class="toolbar-left">
      <button id="btn-back" class="btn-icon" title="Back" aria-label="Go back">&#8592;</button>
      <input type="text" id="doc-title-input" class="toolbar-title-input" placeholder="Document Title" value="" aria-label="Document title">
    </div>
    <div class="toolbar-right">
      <button id="btn-save" class="btn-primary">Save</button>
      <button id="btn-theme" class="btn-icon" title="Toggle theme" aria-label="Toggle theme">${getThemeIcon()}</button>
    </div>
  `;

  const main = document.getElementById("main-content");
  main.innerHTML = `
    <div id="editor-container" class="editor-container"></div>
  `;

  Editor.init(document.getElementById("editor-container"), "", () => {
    scheduleAutoSave();
  });

  document.getElementById("btn-back").addEventListener("click", () => {
    window.location.hash = "#/";
  });

  document.getElementById("btn-save").addEventListener("click", saveCurrentDoc);

  document.getElementById("btn-theme").addEventListener("click", () => {
    toggleTheme();
    document.getElementById("btn-theme").innerHTML = getThemeIcon();
  });
}

// ── Document View/Edit Page ─────────────────────────────────────────────

async function renderDocPage(slug, mode) {
  showLoading(true);

  try {
    // Use public lookup so shared links work across users
    const doc = await DocumentsDB.getBySlugPublic(slug);
    if (!doc) {
      showLoading(false);
      showToast("Document not found.");
      window.location.hash = "#/";
      return;
    }

    currentDoc = doc;
    isOwner = doc.ownerEmail === currentUser?.email;

    // Non-owners are forced to preview mode
    currentMode = isOwner && mode === "edit" ? "edit" : "preview";

    renderDocToolbar(doc);
    await renderDocContent(doc);
  } catch (error) {
    console.error("Error loading document:", error);
    showToast("Failed to load document.");
    window.location.hash = "#/";
  }

  showLoading(false);
}

function renderDocToolbar(doc) {
  const toolbar = document.getElementById("toolbar");
  const isEdit = currentMode === "edit";

  toolbar.innerHTML = `
    <div class="toolbar-left">
      <button id="btn-back" class="btn-icon" title="Back" aria-label="Go back">&#8592;</button>
      ${
        isEdit && isOwner
          ? `<input type="text" id="doc-title-input" class="toolbar-title-input" value="${escapeAttr(doc.title || "")}" aria-label="Document title">`
          : `<h1 class="toolbar-title">${escapeHtml(doc.title || "Untitled")}${!isOwner ? `<span class="shared-badge">Shared</span>` : ""}</h1>`
      }
    </div>
    <div class="toolbar-center">
      ${isOwner ? `
        <div class="mode-toggle" role="tablist" aria-label="View mode">
          <button id="btn-preview-mode" class="mode-btn ${!isEdit ? "active" : ""}" role="tab" aria-selected="${!isEdit}">Preview</button>
          <button id="btn-edit-mode" class="mode-btn ${isEdit ? "active" : ""}" role="tab" aria-selected="${isEdit}">Edit</button>
        </div>
      ` : ""}
    </div>
    <div class="toolbar-right">
      ${isEdit && isOwner ? `<button id="btn-save" class="btn-primary">Save</button>` : ""}
      <button id="btn-zoom-out" class="btn-icon" title="Zoom Out" aria-label="Zoom out">&minus;</button>
      <span id="zoom-level" class="zoom-level" aria-live="polite">100%</span>
      <button id="btn-zoom-in" class="btn-icon" title="Zoom In" aria-label="Zoom in">+</button>
      <button id="btn-zoom-reset" class="btn-icon" title="Reset Zoom" aria-label="Reset zoom">&#8634;</button>
      <button id="btn-copy-md" class="btn-icon" title="Copy Markdown" aria-label="Copy markdown to clipboard">&#128203;</button>
      <button id="btn-download" class="btn-icon" title="Download .md" aria-label="Download as markdown file">&#8615;</button>
      <button id="btn-comments" class="btn-icon ${currentMode === "preview" ? "" : "hidden"}" title="Comments" aria-label="Toggle comments panel">&#128172;</button>
      <button id="btn-share" class="btn-icon" title="Copy Share Link" aria-label="Copy share link">&#128279;</button>
      <button id="btn-theme" class="btn-icon" title="Toggle theme" aria-label="Toggle theme">${getThemeIcon()}</button>
    </div>
  `;

  // Wire toolbar
  document.getElementById("btn-back").addEventListener("click", () => {
    window.location.hash = "#/";
  });

  document.getElementById("btn-theme").addEventListener("click", () => {
    toggleTheme();
    document.getElementById("btn-theme").innerHTML = getThemeIcon();
  });

  if (isOwner) {
    const previewBtn = document.getElementById("btn-preview-mode");
    const editBtn = document.getElementById("btn-edit-mode");

    if (previewBtn) {
      previewBtn.addEventListener("click", () => {
        if (currentMode === "edit") {
          if (currentDoc) {
            currentDoc.content = Editor.getContent();
            const titleInput = document.getElementById("doc-title-input");
            if (titleInput) currentDoc.title = titleInput.value;
          }
          currentMode = "preview";
          window.location.hash = `#/doc/${currentDoc.slug}`;
        }
      });
    }

    if (editBtn) {
      editBtn.addEventListener("click", () => {
        if (currentMode !== "edit") {
          currentMode = "edit";
          window.location.hash = `#/doc/${currentDoc.slug}/edit`;
        }
      });
    }

    const saveBtn = document.getElementById("btn-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", saveCurrentDoc);
    }
  }

  // Zoom
  document.getElementById("btn-zoom-in").addEventListener("click", () => zoomBy(0.1));
  document.getElementById("btn-zoom-out").addEventListener("click", () => zoomBy(-0.1));
  document.getElementById("btn-zoom-reset").addEventListener("click", resetZoom);

  // Comments toggle
  const commentsBtn = document.getElementById("btn-comments");
  if (commentsBtn) {
    commentsBtn.addEventListener("click", () => {
      const panel = document.getElementById("comments-panel");
      if (panel) panel.classList.toggle("open");
    });
  }

  // Share (with clipboard error handling)
  document.getElementById("btn-share").addEventListener("click", () => {
    const url = `${window.location.origin}${window.location.pathname}#/doc/${currentDoc.slug}`;
    navigator.clipboard.writeText(url).then(
      () => showToast("Share link copied to clipboard!"),
      () => showToast("Failed to copy link")
    );
  });

  // Copy markdown content (with clipboard error handling)
  document.getElementById("btn-copy-md").addEventListener("click", () => {
    const content = currentDoc.content || "";
    navigator.clipboard.writeText(content).then(
      () => showToast("Markdown copied to clipboard!"),
      () => showToast("Failed to copy content")
    );
  });

  // Download as .md file
  document.getElementById("btn-download").addEventListener("click", () => {
    const content = currentDoc.content || "";
    const title = (currentDoc.title || "document").replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || "document";
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Downloaded!");
  });
}

async function renderDocContent(doc) {
  const main = document.getElementById("main-content");

  if (currentMode === "edit") {
    main.innerHTML = `<div id="editor-container" class="editor-container"></div>`;
    Editor.init(
      document.getElementById("editor-container"),
      doc.content || "",
      () => scheduleAutoSave()
    );
  } else {
    main.innerHTML = `
      <div class="preview-layout">
        <div id="preview-wrapper" class="preview-wrapper">
          <div id="preview-container" class="preview-container markdown-body">
          </div>
        </div>
        <div id="comments-panel" class="comments-panel"></div>
      </div>
    `;

    const previewContainer = document.getElementById("preview-container");
    previewContainer.innerHTML = MarkdownRenderer.render(doc.content || "");
    await MarkdownRenderer.postRender(previewContainer);

    // Init zoom
    initPreviewZoom();

    // Init comments (await initial load before polling)
    const panel = document.getElementById("comments-panel");
    Comments.init(doc.id, currentUser, panel, () => {
      Comments.highlightAnchors(previewContainer);
    });
    await Comments.load();
    Comments.highlightAnchors(previewContainer);
    Comments.setupSelectionHandler(previewContainer);
    Comments.startPolling();
  }
}

// ── Save ────────────────────────────────────────────────────────────────

async function saveCurrentDoc() {
  if (isSaving) return;
  isSaving = true;

  try {
    const content = Editor.getContent();
    const titleInput = document.getElementById("doc-title-input");
    const title =
      titleInput?.value?.trim() ||
      DocumentsDB._extractTitle(content) ||
      "Untitled";

    if (currentDoc) {
      // Update existing
      await DocumentsDB.update(currentDoc.id, {
        title,
        content,
        lastEditedBy: {
          email: currentUser?.email,
          fullName: currentUser?.fullName,
          timestamp: new Date().toISOString(),
        },
      });
      currentDoc.title = title;
      currentDoc.content = content;
      showToast("Document saved!");
    } else {
      // Create new
      const doc = await DocumentsDB.create({
        title,
        content,
        owner: currentUser
          ? {
              email: currentUser.email,
              fullName: currentUser.fullName,
              slackImageUrl: currentUser.slackImageUrl || "",
            }
          : null,
      });
      if (doc) {
        currentDoc = doc;
        showToast("Document created!");
        window.location.hash = `#/doc/${doc.slug}/edit`;
      }
    }
  } finally {
    isSaving = false;
  }
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (currentDoc && currentMode === "edit") {
      saveCurrentDoc();
    }
  }, 3000);
}

// ── File Upload / Drag & Drop ───────────────────────────────────────────

function setupDropZone(dropZone) {
  if (!dropZone) return;

  ["dragenter", "dragover"].forEach((event) => {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("drop-zone-active");
    });
  });

  ["dragleave", "drop"].forEach((event) => {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("drop-zone-active");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    handleFileUpload(files);
  });

  // Also allow clicking or pressing Enter on the drop zone to upload
  const triggerUpload = () => {
    const input = document.getElementById("file-upload-input");
    if (input) input.click();
  };
  dropZone.addEventListener("click", triggerUpload);
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      triggerUpload();
    }
  });
}

function setupGlobalDragDrop() {
  let dragCounter = 0;

  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    document.body.classList.add("dragging-file");
  });

  document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      document.body.classList.remove("dragging-file");
    }
  });

  document.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove("dragging-file");

    // Only handle if dropped outside the dedicated drop zone
    const dropZone = document.getElementById("drop-zone");
    if (dropZone && dropZone.contains(e.target)) return; // handled by drop zone

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  });
}

async function handleFileUpload(files) {
  if (!files || files.length === 0) return;

  showLoading(true);
  let importedCount = 0;

  for (const file of files) {
    if (
      !file.name.endsWith(".md") &&
      !file.name.endsWith(".markdown") &&
      !file.name.endsWith(".txt")
    ) {
      showToast(`Skipped "${file.name}" - only .md, .markdown, .txt files accepted`);
      continue;
    }

    if (file.size > MAX_FILE_SIZE) {
      showToast(`Skipped "${file.name}" - file too large (max 5MB)`);
      continue;
    }

    try {
      const content = await readFileAsText(file);
      const title =
        DocumentsDB._extractTitle(content) ||
        file.name.replace(/\.(md|markdown|txt)$/, "");

      await DocumentsDB.create({
        title,
        content,
        owner: currentUser
          ? {
              email: currentUser.email,
              fullName: currentUser.fullName,
              slackImageUrl: currentUser.slackImageUrl || "",
            }
          : null,
      });
      importedCount++;
    } catch (error) {
      console.error(`Error importing ${file.name}:`, error);
      showToast(`Error importing "${file.name}"`);
    }
  }

  showLoading(false);

  if (importedCount > 0) {
    showToast(
      `Imported ${importedCount} document${importedCount > 1 ? "s" : ""}!`
    );
    // Refresh list if on home page
    if (
      window.location.hash === "#/" ||
      window.location.hash === "#" ||
      window.location.hash === ""
    ) {
      await loadDocumentsList();
    }
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ── Zoom (CSS-based, preserves scroll) ──────────────────────────────────

function initPreviewZoom() {
  const wrapper = document.getElementById("preview-wrapper");
  if (!wrapper) return;

  currentZoom = 1;
  applyZoom();

  // Ctrl/Cmd + scroll wheel to zoom
  wrapper.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      zoomBy(delta);
    }
  }, { passive: false });
}

function destroyPreviewZoom() {
  currentZoom = 1;
}

function zoomBy(delta) {
  currentZoom = Math.min(5, Math.max(0.25, currentZoom + delta));
  applyZoom();
}

function resetZoom() {
  currentZoom = 1;
  applyZoom();
}

function applyZoom() {
  const container = document.getElementById("preview-container");
  if (!container) return;
  container.style.transform = `scale(${currentZoom})`;
  container.style.transformOrigin = "top center";
  updateZoomDisplay();
}

function updateZoomDisplay() {
  const el = document.getElementById("zoom-level");
  if (!el) return;
  el.textContent = `${Math.round(currentZoom * 100)}%`;
}

// ── Keyboard Shortcuts ──────────────────────────────────────────────────

function handleKeyboardShortcut(e) {
  // Cmd/Ctrl + S = Save
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    if (currentMode === "edit" && isOwner) saveCurrentDoc();
  }

  // Cmd/Ctrl + E = Toggle edit (owners only)
  if ((e.metaKey || e.ctrlKey) && e.key === "e") {
    e.preventDefault();
    if (!currentDoc || !isOwner) return;
    if (currentMode === "edit") {
      currentDoc.content = Editor.getContent();
      window.location.hash = `#/doc/${currentDoc.slug}`;
    } else {
      window.location.hash = `#/doc/${currentDoc.slug}/edit`;
    }
  }

  // Escape = Close panels / go back (but not while focused in text inputs)
  if (e.key === "Escape") {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      active.blur();
      return;
    }
    if (Chat._isOpen) {
      Chat.close();
      return;
    }
    const panel = document.getElementById("comments-panel");
    if (panel && panel.classList.contains("open")) {
      panel.classList.remove("open");
    } else if (currentDoc) {
      window.location.hash = "#/";
    }
  }
}

// ── Utilities ───────────────────────────────────────────────────────────

function showLoading(show) {
  const loader = document.getElementById("loading-overlay");
  if (loader) loader.style.display = show ? "flex" : "none";
}

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("toast-visible"));

  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Theme Toggle ────────────────────────────────────────────────────────

function getTheme() {
  return localStorage.getItem("md-viewer-theme") || "dark";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("md-viewer-theme", theme);

  // Toggle markdown CSS
  const mdDark = document.getElementById("md-css-dark");
  const mdLight = document.getElementById("md-css-light");
  if (mdDark) mdDark.disabled = theme === "light";
  if (mdLight) mdLight.disabled = theme === "dark";

  // Toggle highlight.js CSS
  const hljsDark = document.getElementById("hljs-dark");
  const hljsLight = document.getElementById("hljs-light");
  if (hljsDark) hljsDark.disabled = theme === "light";
  if (hljsLight) hljsLight.disabled = theme === "dark";

  // Update mermaid theme if initialized and re-render existing diagrams
  if (typeof mermaid !== "undefined") {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
      securityLevel: "strict",
    });
    // Re-render existing mermaid diagrams with new theme
    const previewContainer = document.getElementById("preview-container");
    if (previewContainer) {
      MarkdownRenderer.postRender(previewContainer);
    }
  }
}

function toggleTheme() {
  const current = getTheme();
  setTheme(current === "dark" ? "light" : "dark");
}

function getThemeIcon() {
  return getTheme() === "dark" ? "&#9788;" : "&#9790;";
}

function applyInitialTheme() {
  setTheme(getTheme());
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeAttr(text) {
  return String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Boot ────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", initApp);
