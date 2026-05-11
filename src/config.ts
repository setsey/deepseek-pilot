import vscode from 'vscode';

export function getDebugLoggingEnabled(): boolean {
  return vscode.workspace.getConfiguration('deepseek-qa').get<boolean>('debug', false);
}

export function getBaseUrl(): string {
  return vscode.workspace.getConfiguration('deepseek-qa').get<string>('baseUrl', 'https://api.deepseek.com');
}

export function getMaxTokens(): number {
  return vscode.workspace.getConfiguration('deepseek-qa').get<number>('maxTokens', 0);
}

export function getVisionModelSetting(): string {
  return vscode.workspace.getConfiguration('deepseek-qa').get<string>('visionModel', '');
}

export function getVisionPrompt(): string {
  return vscode.workspace.getConfiguration('deepseek-qa').get<string>(
    'visionPrompt',
    'Describe the visual contents of this image in detail, including any text, objects, people, or context that would be relevant for understanding it. Focus on factual visual elements.',
  );
}
