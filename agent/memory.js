import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_PATH = path.join(__dirname, "..", "memory.json");

export function loadMemory() {
  try {
    const raw = fs.readFileSync(MEMORY_PATH, "utf-8");
    const data = JSON.parse(raw);
    return data.facts || [];
  } catch {
    return [];
  }
}

export function saveMemory(facts) {
  fs.writeFileSync(MEMORY_PATH, JSON.stringify({ facts }, null, 2));
}

/**
 * Ask GPT to extract new personal facts from the latest exchange.
 * Runs in the background — call without await if you don't want to block.
 */
export async function extractFacts(openai, userText, assistantReply) {
  const existing = loadMemory();

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `You extract personal facts about the user from conversations.
Current known facts:
${existing.length ? existing.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(none yet)"}

Rules:
- Only output NEW facts not already in the list above.
- Facts are short statements like "User's name is Jack", "User likes rock music", "User works as a developer".
- If there are no new facts, output exactly: []
- Output a JSON array of strings, nothing else.`
        },
        {
          role: "user",
          content: `User said: "${userText}"\nAssistant replied: "${assistantReply}"`
        }
      ]
    });

    const parsed = JSON.parse(res.choices[0].message.content.trim());
    if (Array.isArray(parsed) && parsed.length > 0) {
      const updated = [...existing, ...parsed];
      saveMemory(updated);
      console.log("[Memory] New facts saved:", parsed);
    }
  } catch (e) {
    console.error("[Memory] Extraction error:", e.message);
  }
}
