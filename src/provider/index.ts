import vscode from 'vscode';
import { AuthManager } from '../auth';
import { MODELS, WELCOME_SHOWN_KEY, WALKTHROUGH_ID } from '../consts';
import { logger } from '../logger';
import { toChatInfo } from './models';
import { prepareChatRequest } from './request';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { ReasoningCache, fingerprintAssistantTurn } from './cache';
import { createVisionModelGetter, setVisionProxyModel } from './vision/index';
import { BalanceTracker } from './balance';
import type { DSUsage } from '../types';

export class DeepSeekChatProvider implements vscode.LanguageModelChatProvider {
  private readonly authManager: AuthManager;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private isActive = true;
  private reasoningCache = new ReasoningCache();
  private vision = createVisionModelGetter();
  private balanceTracker: BalanceTracker;
  private charsPerToken = 4.0;
  private currentMessages: readonly vscode.LanguageModelChatRequestMessage[] = [];

  readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

  constructor(
    context: vscode.ExtensionContext,
    statusBar: vscode.StatusBarItem,
  ) {
    this.authManager = new AuthManager(context);
    this.balanceTracker = new BalanceTracker(statusBar);

    context.subscriptions.push(
      this.onDidChangeEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('deepseek-qa.apiKey') ||
          e.affectsConfiguration('deepseek-qa.visionModel')
        ) {
          this.vision.reset();
          this.onDidChangeEmitter.fire();
        }
      }),
      context.secrets.onDidChange((e) => {
        if (e.key === 'deepseek-qa.apiKey') {
          this.onDidChangeEmitter.fire();
        }
      }),
    );

    this.refreshModelPicker();
  }

  // ── Public commands ──

  async configureApiKey(): Promise<void> {
    const saved = await this.authManager.promptForApiKey();
    if (saved) this.onDidChangeEmitter.fire();
  }

  async clearApiKey(): Promise<void> {
    await this.authManager.deleteApiKey();
    this.onDidChangeEmitter.fire();
    vscode.window.showInformationMessage('DeepSeek API key removed.');
  }

  async hasApiKey(): Promise<boolean> {
    return this.authManager.hasApiKey();
  }

  refreshModelPicker(): void {
    this.onDidChangeEmitter.fire();
  }

  async prepareForDeactivate(): Promise<void> {
    this.isActive = false;
    this.onDidChangeEmitter.fire();
    try {
      await vscode.lm.selectChatModels({ vendor: 'deepseek-qa' });
    } catch { /* ignore */ }
  }

  async setVisionProxyModel(): Promise<void> {
    await setVisionProxyModel();
    this.vision.reset();
  }

  async refreshBalance(): Promise<void> {
    const key = await this.authManager.getApiKey();
    if (!key) {
      vscode.window.showWarningMessage('Set your DeepSeek API key first.');
      return;
    }
    await this.balanceTracker.refreshBalance(key);
  }

  clearSession(): void {
    this.balanceTracker.clearSession();
  }

  getCacheStats(): ReturnType<ReasoningCache['stats']> {
    return this.reasoningCache.stats();
  }

  // ── LanguageModelChatProvider ──

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (!this.isActive) return [];
    const hasKey = await this.authManager.hasApiKey();
    return MODELS.map((model) => toChatInfo(model, hasKey));
  }

  async provideLanguageModelChatResponse(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.currentMessages = messages;

    const prepared = await prepareChatRequest({
      authManager: this.authManager,
      modelInfo,
      messages,
      options,
      token,
      reasoningCache: this.reasoningCache,
      getVisionModel: () => this.vision.get(),
    });

    // Cache reasoning fingerprint before streaming
    const thinking = prepared.thinking;

    await streamChatCompletion({
      prepared,
      progress,
      token,
      reasoningCache: this.reasoningCache,
      onUsage: (model: string, usage: DSUsage) => {
        this.balanceTracker.recordUsage(model, usage);
      },
      onCharsPerToken: (ratio: number) => {
        this.charsPerToken = this.charsPerToken * 0.9 + ratio * 0.1;
      },
    });

    // After streaming, cache reasoning for tool-call turns
    if (thinking) {
      const userMessages = messages.filter(
        (m) => m.role === vscode.LanguageModelChatMessageRole.User,
      );
      const fp = fingerprintAssistantTurn(
        userMessages.map((m) => ({ role: 'user', content: typeof m.content === 'string' ? m.content : '' })),
      );
      // Reasoning was gathered by the stream handler; we need to capture it.
      // For now, the stream module handles caching internally.
    }
  }

  async provideTokenCount(
    _modelInfo: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return estimateTokenCount(text, this.charsPerToken);
  }

  dispose(): void {
    this.isActive = false;
  }
}
