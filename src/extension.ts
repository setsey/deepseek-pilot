import vscode from 'vscode';
import { getDebugLoggingEnabled } from './config';
import { WALKTHROUGH_ID, WELCOME_SHOWN_KEY } from './consts';
import { logger } from './logger';
import { DeepSeekChatProvider } from './provider/index';
import { setCopilotUtilityModel } from './utility-model';

let activeProvider: DeepSeekChatProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const extVersion = context.extension.packageJSON.version as string;
  const vscodeVersion = vscode.version;
  const userAgent = `deepseek-v4-qa/${extVersion} VSCode/${vscodeVersion}`;

  logger.info(
    `DeepSeek V4 QA activating version=${extVersion} debug=${getDebugLoggingEnabled()}`,
  );

  // Combined status bar item: context-window saturation (with colour states
  // for warn/critical), session cost, and platform balance — all in one
  // glance. Tooltip has full breakdowns and compaction guidance.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'deepseek-qa.manage';
  statusBar.name = 'DeepSeek V4 QA';
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('deepseek-qa.showLogs', () => logger.show()),
    vscode.commands.registerCommand('deepseek-qa.getApiKey', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://platform.deepseek.com/api_keys')),
    ),
  );

  try {
    const provider = new DeepSeekChatProvider(context, statusBar, userAgent);
    activeProvider = provider;

    context.subscriptions.push(
      vscode.commands.registerCommand('deepseek-qa.manage', async () => {
        const picked = await vscode.window.showQuickPick(
          [
            { label: '$(key) Set API Key', id: 'setApiKey' },
            { label: '$(trash) Clear API Key', id: 'clearApiKey' },
            { label: '$(eye) Set Vision Proxy Model', id: 'setVisionModel' },
            { label: '$(sparkle) Use as Copilot Utility Model', id: 'setUtilityModel', description: 'titles, summaries, commits, intent' },
            { label: '$(zap) Use as Copilot Utility Small Model', id: 'setUtilitySmallModel', description: 'fast, lightweight flows' },
            { label: '$(refresh) Refresh Balance', id: 'refreshBalance' },
            { label: '$(clear-all) Clear Session Counter', id: 'clearSession' },
            { label: '$(history) Show Context Window Details', id: 'showContextWindow' },
            { label: '$(database) Show Reasoning Cache Stats', id: 'showCacheStats' },
            { label: '$(trashcan) Clear Reasoning Cache', id: 'clearReasoningCache' },
            { label: '$(gear) Open Extension Settings', id: 'openSettings' },
            { label: '$(link-external) Get DeepSeek API Key', id: 'getApiKey' },
            { label: '$(output) Show Logs', id: 'showLogs' },
          ],
          {
            title: `Manage DeepSeek V4 QA Provider (v${extVersion})`,
            placeHolder: 'Choose an action',
            matchOnDescription: true,
          },
        );

        switch (picked?.id) {
          case 'setApiKey':
            await provider.configureApiKey();
            break;
          case 'clearApiKey':
            await provider.clearApiKey();
            break;
          case 'setVisionModel':
            await provider.setVisionProxyModel();
            break;
          case 'setUtilityModel':
            await setCopilotUtilityModel('primary');
            break;
          case 'setUtilitySmallModel':
            await setCopilotUtilityModel('small');
            break;
          case 'refreshBalance':
            await provider.refreshBalance();
            break;
          case 'clearSession':
            provider.clearSession();
            break;
          case 'showContextWindow':
            void vscode.commands.executeCommand('deepseek-qa.showContextWindow');
            break;
          case 'showCacheStats':
            void vscode.commands.executeCommand('deepseek-qa.showCacheStats');
            break;
          case 'clearReasoningCache':
            void vscode.commands.executeCommand('deepseek-qa.clearReasoningCache');
            break;
          case 'openSettings':
            await vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'deepseek-qa',
            );
            break;
          case 'getApiKey':
            await vscode.env.openExternal(
              vscode.Uri.parse('https://platform.deepseek.com/api_keys'),
            );
            break;
          case 'showLogs':
            logger.show();
            break;
          default:
            break;
        }
      }),
      vscode.commands.registerCommand('deepseek-qa.setApiKey', () => provider.configureApiKey()),
      vscode.commands.registerCommand('deepseek-qa.clearApiKey', () => provider.clearApiKey()),
      vscode.commands.registerCommand('deepseek-qa.setVisionModel', () =>
        provider.setVisionProxyModel(),
      ),
      vscode.commands.registerCommand('deepseek-qa.setUtilityModel', () =>
        setCopilotUtilityModel('primary'),
      ),
      vscode.commands.registerCommand('deepseek-qa.setUtilitySmallModel', () =>
        setCopilotUtilityModel('small'),
      ),
      vscode.commands.registerCommand('deepseek-qa.refreshBalance', () =>
        provider.refreshBalance(),
      ),
      vscode.commands.registerCommand('deepseek-qa.clearSession', () => provider.clearSession()),
      vscode.commands.registerCommand('deepseek-qa.showContextWindow', () =>
        provider.showContextWindow(),
      ),
      vscode.commands.registerCommand('deepseek-qa.clearReasoningCache', async () => {
        const choice = await vscode.window.showWarningMessage(
          'Clear the persistent DeepSeek reasoning cache? Multi-turn thinking conversations may temporarily fall back to empty reasoning chains on the next reply.',
          { modal: false },
          'Clear',
        );
        if (choice !== 'Clear') return;
        provider.clearReasoningCache();
        void vscode.window.showInformationMessage('DeepSeek reasoning cache cleared.');
      }),
      vscode.commands.registerCommand('deepseek-qa.showCacheStats', () => {
        const stats = provider.getCacheStats();
        const hitPct = (stats.hitRate * 100).toFixed(1);
        const totalKB = (stats.totalBytes / 1024).toFixed(1);
        const largestKB = (stats.largestEntryBytes / 1024).toFixed(1);
        const totalMaxMB = (stats.totalBytesMax / 1024 / 1024).toFixed(0);
        const usagePct =
          stats.totalBytesMax > 0
            ? ((stats.totalBytes / stats.totalBytesMax) * 100).toFixed(1)
            : '0';
        const msg = [
          '**DeepSeek V4 QA — Reasoning Cache Stats**',
          '',
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Entries | ${stats.entryCount} / ${stats.maxEntries} |`,
          `| Total size | ${totalKB} KB (${usagePct}% of ${totalMaxMB} MB max) |`,
          `| Largest entry | ${largestKB} KB |`,
          `| Sets / Gets | ${stats.totalSets} / ${stats.totalGets} |`,
          `| Hits / Misses | ${stats.totalHits} / ${stats.totalMisses} |`,
          `| Hit rate | ${hitPct}% |`,
          `| Evictions | ${stats.totalEvictions} |`,
        ].join('\n');

        logger.info('Cache stats requested');
        logger.show();

        const summary = `Cache: ${stats.entryCount} entries, ${hitPct}% hit rate`;
        if (stats.totalMisses > 0 && stats.hitRate < 0.5 && stats.totalGets > 4) {
          void vscode.window.showWarningMessage(
            `${summary} — low hit rate may cause 400 errors in multi-turn conversations. Try starting a new chat.`,
            { modal: false, detail: msg },
          );
        } else {
          void vscode.window.showInformationMessage(summary, { modal: false, detail: msg });
        }
      }),
      vscode.lm.registerLanguageModelChatProvider('deepseek-qa', provider),
      { dispose: () => provider.dispose() },
    );

    provider.refreshModelPicker();

    void showWelcomeIfNeeded(context, provider).catch((error) => {
      logger.warn('Welcome walkthrough failed', error);
    });

    logger.info(`DeepSeek V4 QA activated version=${extVersion}`);
  } catch (error) {
    activeProvider = undefined;
    logger.error('Failed to activate DeepSeek V4 QA extension', error);
    void vscode.window.showErrorMessage('DeepSeek V4 QA: Activation failed. Check the output log.');
    throw error;
  }
}

async function showWelcomeIfNeeded(
  context: vscode.ExtensionContext,
  provider: DeepSeekChatProvider,
): Promise<void> {
  if (context.globalState.get<boolean>(WELCOME_SHOWN_KEY)) return;
  if (await provider.hasApiKey()) {
    await context.globalState.update(WELCOME_SHOWN_KEY, true);
    return;
  }

  await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID);
  await context.globalState.update(WELCOME_SHOWN_KEY, true);
}

export function deactivate(): void {
  if (activeProvider) {
    void activeProvider.prepareForDeactivate();
  }
}
