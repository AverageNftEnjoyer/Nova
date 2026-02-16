# Summarize Skill

## Activation

Activate when the user asks to:
- summarize
- read this
- what does this say
- TLDR

Primary input is usually a URL, but can also be provided text.

## Workflow

### Step 1: Fetch content

If input is a URL, run `web_fetch` first.
If fetch fails, report the exact failure and offer one retry strategy.

### Step 2: Identify content type

Classify the source before summarizing:
- news article
- blog post
- documentation
- academic paper
- product page
- forum/discussion thread

Adjust summary style to content type. Docs need structure; news needs timeline/context.

### Step 3: Produce three summary tiers

Return all tiers in this order:
1. One-line TLDR
2. Three to five key takeaways
3. Detailed summary preserving important nuance, caveats, and assumptions

Do not flatten uncertainty into false certainty.

### Step 4: Metadata extraction

If available, include:
- publication date
- last updated date
- author or publisher
- source URL

If metadata is missing, explicitly say "Not clearly provided."

### Step 5: Quality checks

Before finalizing:
- ensure no major claim was omitted
- ensure dates and numbers are preserved correctly
- ensure summary distinguishes fact vs opinion when obvious

### Step 6: Risk notes

Flag obvious:
- bias
- missing context
- outdated indicators
- promotional framing

## Output Constraints

- Keep language direct and clean.
- Keep bullets high-signal.
- If user asks for "just TLDR," provide only tier 1 unless asked for more.
