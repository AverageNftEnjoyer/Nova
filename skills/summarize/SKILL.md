---
name: summarize
description: Structured summarization workflow for URLs or raw text with metadata extraction, risk notes, and verification checks.
metadata:
  read_when:
    - User asks for a summary, TLDR, or explanation of provided content.
---

# Summarize Skill

## Activation
Use this skill when the user asks to:
- summarize content
- provide a TLDR
- explain what a page or text says

Primary input is usually a URL, but can also be provided text.

## Workflow

### 1. Input handling and fetch
- If input is a URL, run `web_fetch`.
- If fetch fails, report the exact failure and provide one concrete retry path.
- If input is raw text, summarize directly and state that no source fetch was used.

### 2. Classify source type
Classify before summarizing:
- news article
- blog post
- documentation
- academic paper
- product page
- forum/discussion thread

Adjust style to content type. Documentation needs structure; news needs timeline context.

### 3. Produce summary tiers
Default output order:
1. One-line TLDR
2. 3 to 5 key takeaways
3. Detailed summary with nuance, caveats, and assumptions

If user requests "just TLDR," return only tier 1.

### 4. Extract metadata
Include when available:
- publication date
- last updated date
- author or publisher
- source URL

If missing, state: "Not clearly provided."

### 5. Add risk notes
Flag obvious:
- bias
- missing context
- outdated indicators
- promotional framing

### 6. Verification Before Done
Before final output:
- Preserve critical dates, numbers, and named entities.
- Do not convert uncertainty into certainty.
- Distinguish fact vs opinion when clear.
- Ensure no major claim from the source is omitted.

### 7. Confidence grading
End with a confidence grade:
- High: source is clear and internally consistent
- Medium: minor ambiguity or incomplete metadata
- Low: substantial ambiguity, missing context, or source quality concerns

## Completion Criteria
- Output includes the requested summary tier(s) in the correct order.
- Available metadata is included, or explicitly marked missing.
- Risk notes call out bias/context/freshness concerns when present.
- Confidence grade matches source quality and ambiguity level.
