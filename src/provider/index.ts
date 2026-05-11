import vscode from 'vscode';
import { AuthManager } from '../auth';
import { MODELS, WELCOME_SHOWN_KEY, WALKTHROUGH_ID } from '../consts';
import { logger } from '../logger';
import { toChatInfo } from './models';
import { prepareChatRequest } from './request';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { ReasoningCache, type CachedTurn } from './cache';
import { createVisionModelGetter, setVisionProxyModel } from './vision/index';
import { BalanceTracker } from './balance';
import type { DSUsage } from '../types';

const REASONING_CACHE_STATE_KEY = 'deepseek-qa.reasoningCache';

export class DeepSeekChatProvider implements vscode.LanguageModelChatProvider {
  private readonly authManager: AuthManager;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private readonly globalState: vscode.Memento;
  private isActive = true;
  private persistTimer: NodeJS.Timeout | undefined;
  private reasoningCache = new ReasoningCache();
  private vision = createVisionModelGetter();
  private balanceTracker: BalanceTracker;
  private charsPerToken = 4.0;

  readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

  constructor(
    context: vscode.ExtensionContext,
    statusBar: vscode.StatusBarItem,
  ) {
    this.authManager = new AuthManager(context);
    this.globalState = context.globalState;
    this.balanceTracker = new BalanceTracker(statusBar);

    const savedCache = this.globalState.get<CachedTurn[]>(REASONING_CACHE_STATE_KEY);
    if (Array.isArray(savedCache) && savedCache.length > 0) {
      this.reasoningCache.restore(savedCache);
      logger.info(`Restored ${this.reasoningCache.serialize().length} reasoning cache entries`);
    }

    this.reasoningCache.setOnChange(() => {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
      }

      this.persistTimer = setTimeout(() => {
        void this.globalState.update(REASONING_CACHE_STATE_KEY, this.reasoningCache.serialize());
        this.persistTimer = undefined;
      }, 200);
    });

    context.subscriptions.push(
      this.onDidChangeEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('deepseek-qa.visionModel')) {
          this.vision.reset();
          this.onDidChangeEmitter.fire();
        }

        if (
          e.affectsConfiguration('deepseek-qa.reasoningEffort') ||
          e.affectsConfiguration('deepseek-qa.baseUrl')
        ) {
          this.balanceTracker.refreshDisplay();
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

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    await this.globalState.update(REASONING_CACHE_STATE_KEY, this.reasoningCache.serialize());

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

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    void this.globalState.update(REASONING_CACHE_STATE_KEY, this.reasoningCache.serialize());
  }
}
