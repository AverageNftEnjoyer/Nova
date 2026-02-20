# NLP Preprocessing Pipeline

Nova preprocesses every inbound user message before it reaches the LLM, tool router, or memory system. This improves intent matching and search quality without changing what the user sees.

## raw_text vs clean_text

| Field | Description | Used for |
|-------|-------------|----------|
| `raw_text` | Original user input, never mutated | UI display, transcript persistence, message history |
| `clean_text` | Normalized + spell-corrected version | Tool routing, web search queries, memory recall, LLM call |

The LLM always receives `clean_text`. The transcript stores `raw_text` so conversation history reflects what the user actually typed.

## Pipeline stages

```
raw_text
  → protect     (identify spans that must not be changed)
  → normalize   (NFKC Unicode, whitespace collapse)
  → spellcorrect (dictionary + direct-substitution correction)
  → reassemble
  → clean_text
```

### 1. protect (`src/nlp/protect.ts`)

Scans for spans that are never modified:

- Fenced code blocks ` ``` ... ``` ` and inline code `` `...` ``
- URLs (`http://`, `https://`, `ftp://`)
- Email addresses
- Windows paths (`C:\...`) and POSIX paths (`/usr/...`)
- Environment variable names (`ALL_CAPS_UNDERSCORE`)
- UUIDs, hex strings
- Numbers, dates, times, semantic versions
- npm scoped packages (`@scope/pkg`)

### 2. normalize (`src/nlp/normalize.ts`)

Applied to unprotected spans only:

- NFKC Unicode normalization (fullwidth → ASCII, ligatures → plain, etc.)
- Non-breaking spaces and zero-width chars → regular space
- Whitespace run collapse

### 3. spellcorrect (`src/nlp/spellcorrect.ts`)

Applied to unprotected spans only. Backed by **nspell + dictionary-en** (Hunspell, ~200,000 English word forms):

- **Informal substitution table**: handles common informal/phonetic forms that Hunspell doesn't know or ranks incorrectly (`nite→night`, `gonna→going to`, `whats→what's`, etc.). This is purely informal English — not a brand list.
- **Hunspell dictionary lookup**: nspell returns ranked suggestions; we accept the top suggestion when confidence is high enough.
- **Confidence scoring**: based on the number of suggestions nspell returns (fewer = more confident) and the edit distance to the top suggestion. Corrections with many equidistant candidates are rejected as ambiguous.
- **Proper noun heuristic**: Title-case tokens where both the original and lowercase form are unknown to the dictionary are treated as proper nouns and skipped — no hardcoded brand lists needed.

### 4. lexicon (`src/nlp/lexicon.ts`)

**Algorithmic skip guards** — not a hardcoded brand list:

- Token length < 3 or > 30 characters
- Contains any digit (version numbers, model names, IDs)
- ALL_CAPS (acronyms, constants, env vars)
- camelCase or PascalCase with multiple humps (identifiers)
- kebab-case with 3+ segments (slugs)
- Starts with `-` (CLI flags)
- Standalone file extensions (`.tsx`, `.json`)

User-extensible for project-specific jargon:
```typescript
import { addSkipWords } from "./src/nlp/lexicon.js";
addSkipWords(["mycodename", "internalterm"]);
```

## Correction rules

A correction is applied when:
1. The token is not in a protected span (code, URL, path, env var, UUID, etc.)
2. The token passes all structural skip guards (not ALL_CAPS, not camelCase, etc.)
3. The token is not in the informal substitution table (handled separately)
4. The token is unknown to the Hunspell dictionary
5. The token is not a Title-case unknown word (proper noun heuristic)
6. nspell returns ≤ 15 suggestions AND the top suggestion is within edit distance 2
7. Confidence score ≥ 0.72 (based on suggestion count + edit distance)

## Integration points

### Runtime chat handler (`src/runtime/modules/chat/chat-handler.js`)

Preprocessing runs in `handleInput()` before any routing:

```javascript
const nlpResult = getPreprocess()(text);
const raw_text = nlpResult.raw_text;   // stored in transcript
text = nlpResult.clean_text;           // used for all routing/LLM
```

The HUD broadcast uses `raw_text` (what the user typed). The transcript metadata includes `nlpCleanText` when a correction was made.

### Agent runner (`src/agent/runner.ts`)

Preprocessing runs at the top of `runAgentTurn()`:

```typescript
const nlpResult = preprocess(inboundMessage.text);
const rawUserText = nlpResult.raw_text;   // persisted to transcript
const cleanUserText = nlpResult.clean_text; // used for memory recall + LLM
```

## Running tests

```bash
npm run test:nlp
```

Tests cover all 6 acceptance cases plus edge cases for protection, Unicode normalization, and no-overcorrection guarantees.
