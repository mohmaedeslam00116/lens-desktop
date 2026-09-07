# LENS — Research, in focus.
### نظرة أعمق. فهم أوضح.

**LENS** is an autonomous desktop research workspace that turns complex questions into clear, source-backed understanding. Designed with a focused, monochrome aesthetic inspired by Vercel and Cursor, LENS provides a familiar productivity environment with a native TypeScript embedded engine, live topical discovery, and multi-format report synthesis.

---

## 🌟 Key Capabilities

1. **Focused Research Workspace:**
   - Central framed question composer with quick, balanced, and deep research modes.
   - Targeted search domain focus (All Web, Academic Papers, Community Discussions).
   - Zero-dependency embedded TypeScript engine running locally on port 8000 inside Electron.

2. **Streamed Reasoning & Evidence Progress:**
   - Live research timeline displaying search sub-queries, visited web sources, and academic citations.
   - Transparent gap reflection (STORM & Open Deep Research multi-hop methodology).

3. **Live Intelligence & Discovery Feed:**
   - Real-time global news and trending research topics across Technology & AI, Markets & Finance, Science, and World Affairs.
   - One-click transition from any trending headline into a deep investigation.

4. **Structured Report Dossiers:**
   - Publication-grade markdown reports with inline citations (`[1]`, `[2]`).
   - Contextual GitHub-flavored comparison tables and Mermaid workflow diagrams.
   - Dedicated reading time metrics and dynamic table of contents.

5. **Multi-Provider & Local Model Autonomy:**
   - Dynamic model discovery upon API key configuration.
   - Latency diagnostics and connection testing.
   - Full support for **Google Gemini**, **OpenAI**, **Anthropic Claude**, **Groq**, **DeepSeek**, **OpenRouter**, **Mistral**, and local offline **Ollama**.

6. **Bilingual Navigation (RTL / LTR):**
   - Seamless Arabic and English interfaces with direction-aware layouts and native typography (Inter & Cairo).
   - Upright, left-to-right LENS wordmark preserved across both languages.

7. **Multi-Format Export & Speech:**
   - Instant export to **PDF**, **Microsoft Word (.docx)**, **Markdown (.md)**, and **CSV** for extracted tables.
   - Built-in text-to-speech reading for auditory review.

8. **Resilient Session Lifecycle & Reconnect Recovery:**
   - Monotonic `EventRingBuffer` storing the latest 300 sequential telemetry events for deterministic WebSocket delta replays on reconnect (`?since=<lastEventId>`).
   - Sub-second `<100ms` `AbortController` cancellation preserving partial gathered evidence and draft reports.
   - Formal session state machine (`planning` -> `awaiting_approval` -> `running` -> `completed` / `cancelled` / `budget_exhausted` / `failed`).

9. **Bounded Parallel Ingestion & 3-Level Deduplication Engine:**
   - Asynchronous worker pool (`BoundedScraperPool`) with global ($C_{\text{global}} = 10$) and per-host ($C_{\text{host}} = 2$) concurrency throttles, internal 10s request timeouts, and non-blocking exponential backoff on HTTP 429 rate limits.
   - 3-level deduplication (`DeduplicationEngine`): Level 1 canonical URL normalization, Level 2 exact SHA-256 content hashing invariant to whitespace, casing, and punctuation, and Level 3 64-bit SimHash near-duplicate detection with Hamming distance threshold $\le 3$.
   - Memory-bounded ingestion pipeline keeping 200 ingested sources strictly under 10 MB RAM.

---

## 🏗️ Repository Structure

```
lens-desktop/
├── BRAND.md                   # Brand identity, mark specifications, and voice guidelines
├── CONTEXT.md                 # Project domain model and glossary
├── DESIGN.md                  # Comprehensive design system tokens and component specs
├── PRODUCT.md                 # Product definition, users, positioning, and commitments
├── AGENTS.md                  # Operational guidelines for AI agents and engineering skills
├── docs/                      # Architectural documents and issue tracker setup
│   └── agents/                # GitHub issues, triage labels, and domain doc conventions
├── frontend/                  # Electron desktop application
│   ├── electron/              # Electron main process and embedded engine
│   │   ├── engine/            # Native TypeScript research, search, scraper, and discovery
│   │   ├── main.ts            # Electron window lifecycle
│   │   └── preload.ts         # Secure IPC bridge
│   ├── src/                   # React 18 UI components, state, and styles
│   └── package.json           # Application manifest (Product Name: LENS)
└── package.json               # Root workspace scripts
```

---

## 🚀 Development & Setup

### Prerequisites
- Node.js 18+
- npm

### 1. Install dependencies
```bash
cd frontend
npm install
```

### 2. Start in development mode
```bash
npm run dev
```

---

## 📦 Building the Windows Installer (.exe)

To compile the native desktop executable and NSIS setup installer:

```bash
cd frontend
npm run build:installer
```

The installer will be generated at:
```
frontend/dist-installer/LENS Setup 1.0.0.exe
```

---

## 📄 License
Open source and crafted for research and investigative inquiry.
