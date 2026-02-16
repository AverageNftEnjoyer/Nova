export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    [key: string]: unknown;
  };
  execute: (input: any) => Promise<string>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolPolicy {
  enabledTools: string[];
}

export interface AnthropicToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
  type: "tool_use";
}
