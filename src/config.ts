import vscode from 'vscode';

export type ReasoningEffort = 'high' | 'max';

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('deepseek-pilot');
}

export function getDebugLoggingEnabled(): boolean {
  return getConfig().get<boolean>('debug', false);
}

export function getBaseUrl(): string {
  const configured = getConfig().get<string>('baseUrl', 'https://api.deepseek.com').trim();
  const baseUrl = configured || 'https://api.deepseek.com';
  return baseUrl.replace(/\/+$/, '');
}

export function getApiUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), `${getBaseUrl()}/`).toString();
}

export function getApiModelId(modelId: string): string {
  const overrides = getConfig().get<Record<string, string>>('modelIdOverrides');
  const override = overrides?.[modelId]?.trim();
  return override || modelId;
}

export function getMaxTokens(): number {
  return getConfig().get<number>('maxTokens', 0);
}

export function getReasoningEffort(): ReasoningEffort {
  return getConfig().get<string>('reasoningEffort', 'max') === 'high' ? 'high' : 'max';
}

export function getVisionModelSetting(): string {
  return getConfig().get<string>('visionModel', '');
}

export function getVisionPrompt(): string {
  return getConfig().get<string>(
    'visionPrompt',
    'Describe the visual contents of this image in detail, including any text, objects, people, or context that would be relevant for understanding it. Focus on factual visual elements.',
  );
}
