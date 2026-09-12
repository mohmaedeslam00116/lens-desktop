// ESM bridge for the pi agent SDK inside the CommonJS-compiled engine.
// pi-ai is ESM-only (exports map carries only the "import" condition), so
// dynamic import() from the compiled CJS adapter cannot resolve the package
// specifier. This shim re-exports the pi API and provider factories as an
// importable .mjs module; dist-electron/ contains a copy (see build:electron).
export * from '@earendil-works/pi-ai';
export { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
export { googleProvider } from '@earendil-works/pi-ai/providers/google';
export { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
export { groqProvider } from '@earendil-works/pi-ai/providers/groq';
export { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
export { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
export { mistralProvider } from '@earendil-works/pi-ai/providers/mistral';
export {
  stream as openAiCompletionsStream,
  streamSimple as openAiCompletionsStreamSimple,
} from '@earendil-works/pi-ai/api/openai-completions';