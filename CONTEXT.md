# Domain Model: Deep Research Agent Studio

<!-- matt-skills:domain-model 1 -->

## Glossary

### ResearchSession
A bounded, stateful investigation triggered by a user query. It tracks research depth, selected analytical perspectives, discovered web sources, decomposed subqueries, live telemetry logs, and the resulting synthesized document.

### Perspective
An analytical lens or expert persona (derived from the Stanford STORM methodology) applied to decompose a complex topic into multidimensional inquiries:
- **Technical & Architectural**: Focuses on mechanisms, protocols, benchmarks, code implementations, and specifications.
- **Market & Commercial**: Focuses on industry dynamics, leading companies, economic valuation, adoption trends, and business models.
- **Critical & Skeptical**: Focuses on vulnerabilities, limitations, trade-offs, controversies, and counter-arguments.
- **Balanced & Comprehensive**: General-purpose cross-sectional investigation combining all facets.

### Subquery
A targeted, search-engine-optimized boolean or semantic query dynamically synthesized by the agent to investigate a specific facet of a perspective.

### Source & Evidence
An external digital document scraped and analyzed by the agent. Each source carries a canonical URL, extracted title, domain authority score (0–100%), relevance snippet, and publication timestamp when available.

### Reflection & Gap Analysis
An intermediate reasoning phase (derived from Open Deep Research) where the agent pauses after initial web exploration to audit its findings, identify unanswered sub-questions or conflicting data points, and formulate targeted second-hop inquiries.

### LivingReport
The final synthesized deliverable formatted in clean, human-readable Markdown. It includes an Executive Summary, structured chapters with in-line academic citations (`[1]`, `[2]`), a comparative analysis matrix, and a verified bibliography.

### ResearchGraph
A directed acyclic graph (DAG) representing the agent's exploration path: Root Query -> Perspectives -> Subqueries -> Visited Sources -> Synthesized Sections.

### FollowupCopilot
A grounded conversational agent operating adjacent to the LivingReport that answers user inquiries, drafts comparison tables, and interrogates the research findings strictly against the acquired source evidence.

### AIProvider
An inference provider or model gateway (e.g., Google Gemini, OpenAI, Anthropic, Groq, DeepSeek, Ollama, OpenRouter, Mistral). Each provider declares required authentication keys, base endpoints, and available model families.

### ModelDescriptor
A metadata record characterizing an AI model: its canonical identifier (`id`), user-facing label (`name`), maximum context window length (e.g., `128k`, `1M`, `200k`), capability badges (`Reasoning`, `Speed`, `Vision`, `Local`), and whether it is a local offline model.

### ProviderRegistry
A deep backend module responsible for maintaining the catalog of known models across all providers, dynamically discovering models from local Ollama instances (`/api/tags`) or remote gateways (OpenRouter), and executing live connection tests with latency metrics.

### ConnectionTest
A real-time diagnostic ping validating whether the user's API key or local Ollama endpoint is functional before committing to an expensive research run, returning latency in milliseconds and detailed error diagnostics if rejected.
