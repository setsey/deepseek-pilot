import vscode from 'vscode';
import { getDebugLoggingEnabled } from './config';
import { WALKTHROUGH_ID, WELCOME_SHOWN_KEY } from './consts';
import { logger } from './logger';
import { DeepSeekChatProvider } from './provider/index';

let activeProvider: DeepSeekChatProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  logger.info(
    `DeepSeek V4 QA activating version=${context.extension.packageJSON.version} debug=${getDebugLoggingEnabled()}`,
  );

  // Status bar — session spend
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'deepseek-qa.showLogs';
  context.subscriptions.push(statusBar);

  // Output channel already created by logger

  context.subscriptions.push(
    vscode.commands.registerCommand('deepseek-qa.showLogs', () => logger.show()),
    vscode.commands.registerCommand('deepseek-qa.getApiKey', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://platform.deepseek.com/api_keys')),
    ),
  );

  try {
    const provider = new DeepSeekChatProvider(context, statusBar);
    activeProvider = provider;

    context.subscriptions.push(
      vscode.commands.registerCommand('deepseek-qa.manage', async () => {
        const picked = await vscode.window.showQuickPick(
          [
            { label: 'Set API Key', id: 'setApiKey' },
            { label: 'Clear API Key', id: 'clearApiKey' },
            { label: 'Set Vision Proxy Model', id: 'setVisionModel' },
            { label: 'Refresh Balance', id: 'refreshBalance' },
            { label: 'Open Extension Settings', id: 'openSettings' },
            { label: 'Get DeepSeek API Key', id: 'getApiKey' },
            { label: 'Show Logs', id: 'showLogs' },
          ],
          {
            title: 'Manage DeepSeek QA Provider',
            placeHolder: 'Choose an action',
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
          case 'refreshBalance':
            await provider.refreshBalance();
            break;
          case 'openSettings':
            await vscode.commands.executeCommand('workbench.action.openSettings', 'deepseek-qa');
            break;
          case 'getApiKey':
            await vscode.env.openExternal(vscode.Uri.parse('https://platform.deepseek.com/api_keys'));
            break;
          case 'showLogs':
            logger.show();
            break;
          default:
            break;
        }
      }),
      vscode.commands.registerCommand('deepseek-qa.setApiKey', () =>
        provider.configureApiKey(),
      ),
      vscode.commands.registerCommand('deepseek-qa.clearApiKey', () =>
        provider.clearApiKey(),
      ),
      vscode.commands.registerCommand('deepseek-qa.setVisionModel', () =>
        provider.setVisionProxyModel(),
      ),
      vscode.commands.registerCommand('deepseek-qa.refreshBalance', () =>
        provider.refreshBalance(),
      ),
      vscode.commands.registerCommand('deepseek-qa.clearSession', () =>
        provider.clearSession(),
      ),
      vscode.commands.registerCommand('deepseek-qa.showCacheStats', () => {
        const stats = provider.getCacheStats();
        const hitPct = (stats.hitRate * 100).toFixed(1);
        const totalKB = (stats.totalBytes / 1024).toFixed(1);
        const largestKB = (stats.largestEntryBytes / 1024).toFixed(1);
        const msg = [
          '**DeepSeek V4 QA — Reasoning Cache Stats**',
          '',
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Entries | ${stats.entryCount} / ${stats.maxEntries} |`,
          `| Total size | ${totalKB} KB |`,
          `| Largest entry | ${largestKB} KB |`,
          `| Sets / Gets | ${stats.totalSets} / ${stats.totalGets} |`,
          `| Hits / Misses | ${stats.totalHits} / ${stats.totalMisses} |`,
          `| Hit rate | ${hitPct}% |`,
          `| Evictions | ${stats.totalEvictions} |`,
        ].join('\n');
        vscode.window.showInformationMessage(
          `Cache: ${stats.entryCount} entries, ${hitPct}% hit rate`,
          { modal: false, detail: msg },
        );
      }),
      vscode.lm.registerLanguageModelChatProvider('deepseek-qa', provider),
    );

    provider.refreshModelPicker();

    void showWelcomeIfNeeded(context, provider).catch((error) => {
      logger.warn('Welcome walkthrough failed', error);
    });

    logger.info(`DeepSeek V4 QA activated version=${context.extension.packageJSON.version}`);
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
