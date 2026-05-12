import vscode from 'vscode';
import { AuthManager } from '../auth';
import { MODELS } from '../consts';
import { logger } from '../logger';
import { toChatInfo } from './models';
import { prepareChatRequest } from './request';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { ReasoningCache, type CachedTurn } from './cache';
import { createVisionModelGetter, setVisionProxyModel } from './vision/index';
import { BalanceTracker } from './balance';
import { ContextWindowTracker } from './context-window';
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
  private contextTracker: ContextWindowTracker;
  private charsPerToken = 4.0;
  private _tokenCountLogged = false;

  readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

  constructor(
    context: vscode.ExtensionContext,
    statusBar: vscode.StatusBarItem,
    userAgent: string,
  ) {
    this.authManager = new AuthManager(context);
    this.globalState = context.globalState;
    this.balanceTracker = new BalanceTracker(
      statusBar,
      () => this.authManager.getApiKey(),
      userAgent,
    );
    this.contextTracker = new ContextWindowTracker();
    this.balanceTracker.attachContextTracker(this.contextTracker);

    // Restore persisted reasoning cache so multi-turn agent loops survive
    // VS Code restarts.
    const savedCache = this.globalState.get<CachedTurn[]>(REASONING_CACHE_STATE_KEY);
    if (Array.isArray(savedCache) && savedCache.length > 0) {
      this.reasoningCache.restore(savedCache);
      logger.info(`Restored ${this.reasoningCache.serialize().length} reasoning cache entries`);
    }

    this.reasoningCache.setOnChange(() => {
      if (this.persistTimer) clearTimeout(this.persistTimer);
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
          // Try an initial silent balance fetch once a key is available.
          void this.balanceTracker.refreshBalance(true);
        }
      }),
    );

    // Initial silent balance fetch (no-op if no API key configured).
    void this.balanceTracker.refreshBalance(true);

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

    this.balanceTracker.dispose();

    try {
      // Force Copilot Chat to drop our models from the picker before the
      // extension unloads. Returning [] from provideLanguageModelChatInformation
      // (with isActive=false) is what actually removes them.
      await vscode.lm.selectChatModels({ vendor: 'deepseek-qa' });
    } catch {
      /* ignore */
    }
  }

  async setVisionProxyModel(): Promise<void> {
    await setVisionProxyModel();
    this.vision.reset();
  }

  async refreshBalance(): Promise<void> {
    await this.balanceTracker.refreshBalance(false);
  }

  clearSession(): void {
    this.balanceTracker.clearSession();
  }

  getCacheStats(): ReturnType<ReasoningCache['stats']> {
    return this.reasoningCache.stats();
  }

  // ── LanguageModelChatProvider ──

  /**
   * Some VS Code Insider builds call `prepareLanguageModelChatInformation`
   * before `provideLanguageModelChatInformation`. Implementing both is
   * harmless and keeps us forward-compatible.
   */
  async prepareLanguageModelChatInformation(
    _options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    return this.provideLanguageModelChatInformation(
      _options as unknown as vscode.PrepareLanguageModelChatModelOptions,
      _token,
    );
  }

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

    await streamChatCompletion({
      prepared,
      progress,
      token,
      reasoningCache: this.reasoningCache,
      onUsage: (model: string, usage: DSUsage) => {
        this.balanceTracker.recordUsage(model, usage);
        this.contextTracker.recordTurn(modelInfo, usage);
      },
      onCharsPerToken: (ratio: number) => {
        this.charsPerToken = this.charsPerToken * 0.9 + ratio * 0.1;
      },
    });
  }

  async showContextWindow(): Promise<void> {
    await this.contextTracker.showDetails();
  }

  /**
   * Token counting for Copilot Chat.
   *
   * NOTE: Copilot Chat uses `provideTokenCount` for **prompt budgeting**
   * (deciding when to truncate), and that works correctly. However, the
   * **context window display widget** does NOT read from this method —
   * Copilot Chat hardcodes zero usage for all third-party providers
   * (microsoft/vscode#309207, #314722). The fix must ship in Copilot Chat
   * itself. Meanwhile, real usage is tracked via the BalanceTracker (which
   * reads the `usage` field from DeepSeek's SSE stream) and reported in
   * the status bar.
   */
  async provideTokenCount(
    _modelInfo: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const count = estimateTokenCount(text, this.charsPerToken);
    // Log first invocation at info level so users can confirm Copilot Chat
    // is calling provideTokenCount for prompt budgeting. Remaining calls
    // stay at debug level to avoid flooding the output channel.
    if (!this._tokenCountLogged) {
      this._tokenCountLogged = true;
      const shape =
        typeof text === 'string'
          ? `string(len=${text.length})`
          : `message(parts=${Array.isArray(text.content) ? text.content.length : 'non-array'})`;
      logger.info(`provideTokenCount first call → ${count} tokens (charsPerToken=${this.charsPerToken.toFixed(1)}, ${shape})`);
    } else {
      logger.debug(`provideTokenCount → ${count} tokens`);
    }
    return count;
  }

  dispose(): void {
    this.isActive = false;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.balanceTracker.dispose();
    void this.globalState.update(REASONING_CACHE_STATE_KEY, this.reasoningCache.serialize());
  }
}
