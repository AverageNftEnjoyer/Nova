import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createToolRegistry } from "../core/registry.js";

function writeRuntimeConfig(
  workspaceRoot: string,
  userContextId: string,
  payload: Record<string, unknown>,
): void {
  const target = path.join(
    workspaceRoot,
    ".agent",
    "user-context",
    userContextId,
    "integrations-config.json",
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
}

function parseJsonOutput(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw);
  assert.ok(parsed && typeof parsed === "object", "tool output must be JSON object");
  return parsed as Record<string, unknown>;
}

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nova-gmail-tools-"));
}

test("tool registry includes gmail tools when enabled", () => {
  const workspace = makeWorkspace();
  try {
    const tools = createToolRegistry(
      {
        enabledTools: [
          "gmail_capabilities",
          "gmail_list_accounts",
          "gmail_scope_check",
          "gmail_list_messages",
          "gmail_get_message",
          "gmail_daily_summary",
          "gmail_classify_importance",
          "gmail_forward_message",
          "gmail_reply_draft",
        ],
        execApprovalMode: "ask",
        safeBinaries: [],
        webSearchProvider: "brave",
        webSearchApiKey: "",
      },
      {
        workspaceDir: workspace,
        memoryManager: null,
      },
    );
    const names = new Set(tools.map((tool) => tool.name));
    assert.ok(names.has("gmail_capabilities"));
    assert.ok(names.has("gmail_list_accounts"));
    assert.ok(names.has("gmail_scope_check"));
    assert.ok(names.has("gmail_list_messages"));
    assert.ok(names.has("gmail_get_message"));
    assert.ok(names.has("gmail_daily_summary"));
    assert.ok(names.has("gmail_classify_importance"));
    assert.ok(names.has("gmail_forward_message"));
    assert.ok(names.has("gmail_reply_draft"));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("gmail tools return user-safe errors for missing context, disconnected runtime, and missing scope", async () => {
  const workspace = makeWorkspace();
  try {
    writeRuntimeConfig(workspace, "scope-user", {
      gmail: {
        connected: false,
      },
    });
    const tools = createToolRegistry(
      {
        enabledTools: ["gmail_capabilities", "gmail_scope_check"],
        execApprovalMode: "ask",
        safeBinaries: [],
        webSearchProvider: "brave",
        webSearchApiKey: "",
      },
      { workspaceDir: workspace, memoryManager: null },
    );
    const capabilitiesTool = tools.find((tool) => tool.name === "gmail_capabilities");
    const scopeTool = tools.find((tool) => tool.name === "gmail_scope_check");
    assert.ok(capabilitiesTool);
    assert.ok(scopeTool);

    const missingContext = parseJsonOutput(await capabilitiesTool!.execute({}));
    assert.equal(missingContext.ok, false);
    assert.equal(missingContext.errorCode, "BAD_INPUT");
    assert.match(String(missingContext.safeMessage || ""), /user context/i);

    const disconnected = parseJsonOutput(await capabilitiesTool!.execute({ userContextId: "scope-user" }));
    assert.equal(disconnected.ok, true);
    assert.equal((disconnected.data as Record<string, unknown>).connected, false);

    writeRuntimeConfig(workspace, "scope-user", {
      gmail: {
        connected: true,
        activeAccountId: "acct-1",
        email: "scope@example.com",
        scopes: [],
        accounts: [
          {
            id: "acct-1",
            email: "scope@example.com",
            enabled: true,
            scopes: [],
          },
        ],
      },
    });
    const missingScope = parseJsonOutput(await scopeTool!.execute({
      userContextId: "scope-user",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
    }));
    assert.equal(missingScope.ok, false);
    assert.equal(missingScope.errorCode, "MISSING_SCOPE");
    assert.match(String(missingScope.safeMessage || ""), /permission|scope/i);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("gmail tool output stays isolated per userContextId", async () => {
  const workspace = makeWorkspace();
  try {
    writeRuntimeConfig(workspace, "user-a", {
      gmail: {
        connected: true,
        activeAccountId: "acct-a",
        email: "alice@example.com",
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        accessToken: "token-a",
        accounts: [
          {
            id: "acct-a",
            email: "alice@example.com",
            enabled: true,
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
            accessToken: "token-a",
          },
        ],
      },
    });
    writeRuntimeConfig(workspace, "user-b", {
      gmail: {
        connected: true,
        activeAccountId: "acct-b",
        email: "bob@example.com",
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
        accessToken: "token-b",
        accounts: [
          {
            id: "acct-b",
            email: "bob@example.com",
            enabled: true,
            scopes: ["https://www.googleapis.com/auth/gmail.modify"],
            accessToken: "token-b",
          },
        ],
      },
    });
    const tools = createToolRegistry(
      {
        enabledTools: ["gmail_capabilities", "gmail_list_accounts"],
        execApprovalMode: "ask",
        safeBinaries: [],
        webSearchProvider: "brave",
        webSearchApiKey: "",
      },
      { workspaceDir: workspace, memoryManager: null },
    );
    const capabilitiesTool = tools.find((tool) => tool.name === "gmail_capabilities");
    const listAccountsTool = tools.find((tool) => tool.name === "gmail_list_accounts");
    assert.ok(capabilitiesTool);
    assert.ok(listAccountsTool);

    const aPayload = parseJsonOutput(await capabilitiesTool!.execute({
      userContextId: "user-a",
      conversationId: "thread-1",
    }));
    const bPayload = parseJsonOutput(await capabilitiesTool!.execute({
      userContextId: "user-b",
      conversationId: "thread-1",
    }));
    assert.equal(aPayload.ok, true);
    assert.equal(bPayload.ok, true);

    const aData = (aPayload.data || {}) as Record<string, unknown>;
    const bData = (bPayload.data || {}) as Record<string, unknown>;
    assert.equal(aData.email, "alice@example.com");
    assert.equal(bData.email, "bob@example.com");
    assert.notEqual(aData.email, bData.email);
    assert.equal(aData.activeAccountId, "acct-a");
    assert.equal(bData.activeAccountId, "acct-b");

    const aAccountsPayload = parseJsonOutput(await listAccountsTool!.execute({ userContextId: "user-a" }));
    const firstAccount = ((aAccountsPayload.accounts as Array<Record<string, unknown>>)[0] || {});
    assert.equal(Object.prototype.hasOwnProperty.call(firstAccount, "accessToken"), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("gmail list/daily-summary/forward tools run through runtime pipeline with scoped tokens", async () => {
  const workspace = makeWorkspace();
  const originalFetch = globalThis.fetch;
  const authHeaders: string[] = [];
  try {
    writeRuntimeConfig(workspace, "user-a", {
      gmail: {
        connected: true,
        activeAccountId: "acct-a",
        email: "alice@example.com",
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/gmail.compose",
        ],
        accessToken: "token-a",
      },
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      authHeaders.push(String((init?.headers as Record<string, string> | undefined)?.Authorization || ""));
      const url = String(input);
      if (url.includes("/users/me/messages?")) {
        return new Response(
          JSON.stringify({ messages: [{ id: "m1", threadId: "t1" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/users/me/messages/m1?")) {
        return new Response(
          JSON.stringify({
            id: "m1",
            threadId: "t1",
            labelIds: ["UNREAD", "IMPORTANT"],
            snippet: "Need response today",
            internalDate: "1711000000000",
            payload: {
              headers: [
                { name: "From", value: "Boss <boss@yourcompany.com>" },
                { name: "To", value: "alice@example.com" },
                { name: "Subject", value: "Urgent: deadline" },
                { name: "Date", value: "Tue, 20 Feb 2026 10:00:00 +0000" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/users/me/messages/send")) {
        return new Response(
          JSON.stringify({ id: "sent-1", threadId: "t1" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: { message: "Not mocked" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const tools = createToolRegistry(
      {
        enabledTools: ["gmail_list_messages", "gmail_daily_summary", "gmail_forward_message"],
        execApprovalMode: "ask",
        safeBinaries: [],
        webSearchProvider: "brave",
        webSearchApiKey: "",
      },
      { workspaceDir: workspace, memoryManager: null },
    );
    const listTool = tools.find((tool) => tool.name === "gmail_list_messages");
    const summaryTool = tools.find((tool) => tool.name === "gmail_daily_summary");
    const forwardTool = tools.find((tool) => tool.name === "gmail_forward_message");
    assert.ok(listTool);
    assert.ok(summaryTool);
    assert.ok(forwardTool);

    const listPayload = parseJsonOutput(await listTool!.execute({ userContextId: "user-a" }));
    assert.equal(listPayload.ok, true);
    assert.equal(listPayload.count, 1);

    const summaryPayload = parseJsonOutput(await summaryTool!.execute({ userContextId: "user-a" }));
    assert.equal(summaryPayload.ok, true);
    assert.match(String(summaryPayload.summary || ""), /Processed 1 emails/i);

    const forwardPayload = parseJsonOutput(await forwardTool!.execute({
      userContextId: "user-a",
      messageId: "m1",
      to: "client@example.com",
      note: "Please handle this.",
      requireExplicitUserConfirm: true,
    }));
    assert.equal(forwardPayload.ok, true);
    assert.equal((forwardPayload.forwarded as Record<string, unknown>).sentMessageId, "sent-1");

    assert.ok(authHeaders.length >= 4);
    assert.ok(authHeaders.every((value) => value === "Bearer token-a"));
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
