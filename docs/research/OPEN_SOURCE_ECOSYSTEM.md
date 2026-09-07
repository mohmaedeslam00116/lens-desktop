# Research: Open-Source AI Provider & Deep Research Ecosystem

<!-- matt-skills:research 1 -->

## 1. Executive Summary
This document analyzes high-leverage open-source repositories and APIs to expand the AI provider engine and web intelligence capabilities of the **Deep Research Agent Studio**.

---

## 2. Benchmark Repositories & Ecosystem Tools

### 2.1 Provider Routing & Universal LLM Layer
1. **[BerriAI/litellm](https://github.com/BerriAI/litellm)**
   - **Role**: Universal proxy and SDK supporting 100+ LLMs (OpenAI, Gemini, Anthropic, Groq, DeepSeek, Ollama, OpenRouter, Mistral, Together).
   - **Key Advantage**: Standardized OpenAI-compatible request/response formats, token counting, cost tracking, and dynamic exception handling.
   - **Integration**: Used in our backend for all follow-up conversational QA and fallback synthesis.

2. **[OpenRouter API](https://openrouter.ai/docs#models)**
   - **Role**: Universal routing hub giving access to 250+ open and proprietary models via a single API key (`GET https://openrouter.ai/api/v1/models`).
   - **Integration**: Added as a first-class provider in our desktop app, unlocking any model (e.g. `meta-llama/llama-3.3-70b-instruct`, `deepseek/deepseek-r1`, `anthropic/claude-3.7-sonnet`).

3. **[Ollama Model Tags API](https://github.com/ollama/ollama/blob/main/docs/api.md#list-local-models)**
   - **Role**: Local offline inference engine.
   - **Key Advantage**: `GET http://localhost:11434/api/tags` returns dynamically all pulled models (e.g., `llama3.1:8b`, `deepseek-r1:14b`, `mistral:7b`, `qwen2.5:7b`).
   - **Integration**: Real-time auto-discovery of locally installed models with one-click refresh in the UI.

### 2.2 Web Scraping & Agentic Extraction
1. **[unclecode/crawl4ai](https://github.com/unclecode/crawl4ai)**
   - **Role**: Async, LLM-optimized web crawler producing clean, noise-free Markdown.
   - **Key Advantage**: Strips navigation, ads, headers, and footers, reducing context window consumption by up to 70%.

2. **[firecrawl/firecrawl](https://github.com/firecrawl/firecrawl)**
   - **Role**: Turn websites into clean LLM-ready markdown.
   - **Key Advantage**: Handles dynamic JavaScript hydration and anti-bot challenges.

3. **[langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research)**
   - **Role**: Multi-agent research framework on LangGraph with planner, retriever, reviewer, and writer agents.

---

## 3. Dynamic Model Discovery Architecture

```
+──────────────────────────────────────────────────────────────────────────+
|                     DESKTOP SETTINGS & MODEL PICKER                      |
+──────────────────────────────────────────────────────────────────────────+
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
+───────────────────────────────────+   +───────────────────────────────────+
|      LOCAL DISCOVERY (Ollama)     |   |      CLOUD DISCOVERY (LiteLLM)    |
|  GET http://localhost:11434/api/tags| |  Curated Provider Catalogs +     |
|  Lists all local pulled models    |   |  OpenRouter Dynamic API Fetch     |
+───────────────────────────────────+   +───────────────────────────────────+
                                     │
                                     ▼
+──────────────────────────────────────────────────────────────────────────+
|                    UNIFIED PROVIDER REGISTRY & FALLBACK                  |
| - Gemini (gemini-2.0-flash, gemini-2.0-pro, gemini-1.5-pro, etc.)        |
| - OpenAI (gpt-4o, gpt-4o-mini, o1, o3-mini, etc.)                        |
| - Anthropic (claude-3-7-sonnet, claude-3-5-sonnet, claude-3-5-haiku)     |
| - Groq (llama-3.3-70b-versatile, deepseek-r1-distill-llama-70b, etc.)     |
| - DeepSeek (deepseek-chat / v3, deepseek-reasoner / r1)                  |
| - OpenRouter (meta-llama, qwen, mistral, all 200+ models)                |
| - Custom Model Override (free string input for any specialized fine-tune)|
+──────────────────────────────────────────────────────────────────────────+
```
