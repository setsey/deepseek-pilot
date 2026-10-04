import { describe, expect, it } from 'vitest';
import type vscode from 'vscode';
import mock from './vscode-mock';
import { prepareChatRequest } from '../src/provider/request';
import { ReasoningCache } from '../src/provider/cache';
import type { AuthManager } from '../src/auth';

const { LanguageModelTextPart, LanguageModelChatMessageRole, LanguageModelChatToolMode } = mock;

function tool(name: string): vscode.LanguageModelChatTool {
  return { name, description: `${name} tool`, inputSchema: { type: 'object', properties: {} } };
}

async function prepare(
  modelId: string,
  tools: vscode.LanguageModelChatTool[],
  toolMode: number,
): Promise<{ thinking: boolean; body: Record<string, unknown> }> {
  const prepared = await prepareChatRequest({
    authManager: { getApiKey: async () => 'sk-test' } as unknown as AuthManager,
    modelInfo: { id: modelId } as vscode.LanguageModelChatInformation,
    messages: [
      {
        role: LanguageModelChatMessageRole.User,
        content: [new LanguageModelTextPart('Refactor the parser into two functions.')],
      } as unknown as vscode.LanguageModelChatRequestMessage,
    ],
    options: { tools, toolMode } as unknown as vscode.ProvideLanguageModelChatResponseOptions,
    token: { isCancellationRequested: false } as vscode.CancellationToken,
    reasoningCache: new ReasoningCache(),
    getVisionModel: async () => null,
  });
  return { thinking: prepared.thinking, body: JSON.parse(prepared.body) };
}

// DeepSeek 400s `required` / named tool_choice in thinking mode
// (api-docs.deepseek.com/api/create-chat-completion, `tool_choice`).
describe('prepareChatRequest tool_choice vs thinking mode', () => {
  it('turns thinking off when the host forces a single named tool', async () => {
    const { thinking, body } = await prepare(
      'deepseek-flash::thinking',
      [tool('categorize_prompt')],
      LanguageModelChatToolMode.Required,
    );
    expect(thinking).toBe(false);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.tool_choice).toEqual({
      type: 'function',
      function: { name: 'categorize_prompt' },
    });
  });

  it('turns thinking off for a generic required call across several tools', async () => {
    const { thinking, body } = await prepare(
      'deepseek-v4-pro::thinking',
      [tool('read_file'), tool('run_in_terminal')],
      LanguageModelChatToolMode.Required,
    );
    expect(thinking).toBe(false);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.tool_choice).toBe('required');
  });

  it('keeps thinking on for an ordinary agent turn with tool_choice auto', async () => {
    const { thinking, body } = await prepare(
      'deepseek-flash::thinking',
      [tool('read_file'), tool('run_in_terminal')],
      LanguageModelChatToolMode.Auto,
    );
    expect(thinking).toBe(true);
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('max');
    expect(body.tool_choice).toBe('auto');
  });
});
