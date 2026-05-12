import vscode from 'vscode';
import { getDebugLoggingEnabled } from './config';
import { WALKTHROUGH_ID, WELCOME_SHOWN_KEY } from './consts';
import { logger } from './logger';
import { DeepSeekChatProvider } from './provider/index';

let activeProvider: DeepSeekChatProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const extVersion = context.extension.packageJSON.version as string;
  const vscodeVersion = vscode.version;
  const userAgent = `deepseek-v4-qa/${extVersion} VSCode/${vscodeVersion}`;

  logger.info(
    `DeepSeek V4 QA activating version=${extVersion} debug=${getDebugLoggingEnabled()}`,
  );

  // Status bar — session spend (right-aligned at priority 100)
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'deepseek-qa.showLogs';
  statusBar.name = 'DeepSeek Session Spend';
  context.subscriptions.push(statusBar);

  // Status bar — context window (right-aligned at priority 101 so it sits
  // to the LEFT of the spend item, which is the more frequently consulted
  // glance value).
  const contextStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    101,
  );
  context.subscriptions.push(contextStatusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('deepseek-qa.showLogs', () => logger.show()),
    vscode.commands.registerCommand('deepseek-qa.getApiKey', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://platform.deepseek.com/api_keys')),
    ),
  );

  try {
    const provider = new DeepSeekChatProvider(context, statusBar, contextStatusBar, userAgent);
    activeProvider = provider;

    context.subscriptions.push(
      vscode.commands.registerCommand('deepseek-qa.manage', async () => {
        const picked = await vscode.window.showQuickPick(
          [
            { label: '$(key) Set API Key', id: 'setApiKey' },
            { label: '$(trash) Clear API Key', id: 'clearApiKey' },
            { label: '$(eye) Set Vision Proxy Model', id: 'setVisionModel' },
            { label: '$(refresh) Refresh Balance', id: 'refreshBalance' },
            { label: '$(clear-all) Clear Session Counter', id: 'clearSession' },
            { label: '$(history) Show Context Window Details', id: 'showContextWindow' },
            { label: '$(database) Show Reasoning Cache Stats', id: 'showCacheStats' },
            { label: '$(gear) Open Extension Settings', id: 'openSettings' },
            { label: '$(link-external) Get DeepSeek API Key', id: 'getApiKey' },
            { label: '$(output) Show Logs', id: 'showLogs' },
          ],
          {
            title: 'Manage DeepSeek V4 QA Provider',
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
          case 'clearSession':
            provider.clearSession();
            break;
          case 'showContextWindow':
            void vscode.commands.executeCommand('deepseek-qa.showContextWindow');
            break;
          case 'showCacheStats':
            void vscode.commands.executeCommand('deepseek-qa.showCacheStats');
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
      vscode.commands.registerCommand('deepseek-qa.refreshBalance', () =>
        provider.refreshBalance(),
      ),
      vscode.commands.registerCommand('deepseek-qa.clearSession', () => provider.clearSession()),
      vscode.commands.registerCommand('deepseek-qa.showContextWindow', () =>
        provider.showContextWindow(),
      ),
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
