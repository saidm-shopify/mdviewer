# 🧠 MarkdownMind

Your personal markdown knowledge base with AI-powered search.

**Live:** https://markdown-viewer.quick.shopify.io

## What it does

- **Drop & store** `.md` files -- drag, upload, or paste
- **Rich preview** with Mermaid, PlantUML, Excalidraw diagrams and syntax highlighting
- **AI chat** -- ask questions across all your documents (powered by `quick.ai`)
- **Inline comments** -- select text in preview to leave anchored comments
- **Share links** -- anyone with the link gets read-only preview + commenting
- **Dark/light theme** with full CSS variable theming

## Stack

Vanilla JS, no build step. All libraries via CDN:

| Lib | Purpose |
|-----|---------|
| marked v12 | Markdown parsing (GFM) |
| highlight.js v11 | Code syntax highlighting |
| DOMPurify v3 | HTML sanitization |
| mermaid v11 | Diagram rendering |
| pako v2 | Deflate encoding for Kroki API |

**Platform:** Shopify Quick (`quick.db`, `quick.ai`, `quick.id`)

## Deploy

```
quick deploy . markdown-viewer
```
