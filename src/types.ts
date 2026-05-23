export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIFunctionToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface DeepSeekModelVariant {
  id: string;
  displayName: string;
  tooltip: string;
  apiModel: string;
  thinking: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface DSUsage {
  prompt_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

export interface DSBalance {
  currency: 'USD' | 'CNY';
  totalGranted: number;
  totalToppedUp: number;
  totalUsed: number;
  totalBalance: number;
  fetchedAt: number;
}
