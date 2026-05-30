import vscode from 'vscode';
import { getDebugLoggingEnabled } from './config';
import { WALKTHROUGH_ID, WELCOME_SHOWN_KEY } from './consts';
import { logger } from './logger';
import { migrateFromDeepseekQa } from './migrate';
import { DeepSeekChatProvider } from './provider/index';
import { setCopilotUtilityModel } from './utility-model';

let activeProvider: DeepSeekChatProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const extVersion = context.extension.packageJSON.version as string;
  const vscodeVersion = vscode.version;
  const userAgent = `deepseek-pilot/${extVersion} VSCode/${vscodeVersion}`;

  logger.info(
    `DeepSeek Pilot activating version=${extVersion} debug=${getDebugLoggingEnabled()}`,
  );

  // One-shot migration from the previous `deepseek-qa` namespace (the
  // extension formerly known as "deepseek-v4-qa"). Idempotent and best-
  // effort — never blocks activation.
  void migrateFromDeepseekQa(context).catch((error) => {
    logger.warn('Migration shim failed (non-fatal)', error);
  });

  // Combined status bar item: context-window saturation (with colour states
  // for warn/critical), session cost, and platform balance — all in one
  // glance. Tooltip has full breakdowns and compaction guidance.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'deepseek-pilot.manage';
  statusBar.name = 'DeepSeek Pilot';
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('deepseek-pilot.showLogs', () => logger.show()),
    vscode.commands.registerCommand('deepseek-pilot.getApiKey', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://platform.deepseek.com/api_keys')),
    ),
  );

  try {
    const provider = new DeepSeekChatProvider(context, statusBar, userAgent);
    activeProvider = provider;

    context.subscriptions.push(
      vscode.commands.registerCommand('deepseek-pilot.manage', async () => {
        const picked = await vscode.window.showQuickPick(
          [
            { label: vscode.l10n.t('deepseek-pilot.quickpick.setApiKey'), id: 'setApiKey' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.clearApiKey'), id: 'clearApiKey' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.setVisionModel'), id: 'setVisionModel' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.setUtilityModel'), id: 'setUtilityModel', description: 'titles, summaries, commits, intent' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.setUtilitySmallModel'), id: 'setUtilitySmallModel', description: 'fast, lightweight flows' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.refreshBalance'), id: 'refreshBalance' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.clearSession'), id: 'clearSession' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.showContextWindow'), id: 'showContextWindow' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.showCacheStats'), id: 'showCacheStats' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.clearReasoningCache'), id: 'clearReasoningCache' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.openSettings'), id: 'openSettings' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.getApiKey'), id: 'getApiKey' },
            { label: vscode.l10n.t('deepseek-pilot.quickpick.showLogs'), id: 'showLogs' },
          ],
          {
            title: vscode.l10n.t('deepseek-pilot.quickpick.manageTitle', extVersion),
            placeHolder: vscode.l10n.t('deepseek-pilot.quickpick.managePlaceholder'),
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
            void vscode.commands.executeCommand('deepseek-pilot.showContextWindow');
            break;
          case 'showCacheStats':
            void vscode.commands.executeCommand('deepseek-pilot.showCacheStats');
            break;
          case 'clearReasoningCache':
            void vscode.commands.executeCommand('deepseek-pilot.clearReasoningCache');
            break;
          case 'openSettings':
            await vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'deepseek-pilot',
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
      vscode.commands.registerCommand('deepseek-pilot.setApiKey', () => provider.configureApiKey()),
      vscode.commands.registerCommand('deepseek-pilot.clearApiKey', () => provider.clearApiKey()),
      vscode.commands.registerCommand('deepseek-pilot.setVisionModel', () =>
        provider.setVisionProxyModel(),
      ),
      vscode.commands.registerCommand('deepseek-pilot.setUtilityModel', () =>
        setCopilotUtilityModel('primary'),
      ),
      vscode.commands.registerCommand('deepseek-pilot.setUtilitySmallModel', () =>
        setCopilotUtilityModel('small'),
      ),
      vscode.commands.registerCommand('deepseek-pilot.refreshBalance', () =>
        provider.refreshBalance(),
      ),
      vscode.commands.registerCommand('deepseek-pilot.clearSession', () => provider.clearSession()),
      vscode.commands.registerCommand('deepseek-pilot.showContextWindow', () =>
        provider.showContextWindow(),
      ),
      vscode.commands.registerCommand('deepseek-pilot.clearReasoningCache', async () => {
        const choice = await vscode.window.showWarningMessage(
          vscode.l10n.t('deepseek-pilot.clearCache.confirm'),
          { modal: false },
          vscode.l10n.t('deepseek-pilot.clearCache.clear'),
        );
        if (choice !== vscode.l10n.t('deepseek-pilot.clearCache.clear')) return;
        provider.clearReasoningCache();
        void vscode.window.showInformationMessage(vscode.l10n.t('deepseek-pilot.clearCache.cleared'));
      }),
      vscode.commands.registerCommand('deepseek-pilot.showCacheStats', () => {
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
          vscode.l10n.t('deepseek-pilot.context.cacheStatsTitle'),
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

        const summary = vscode.l10n.t('deepseek-pilot.context.cacheLow', String(stats.entryCount), hitPct);
        if (stats.totalMisses > 0 && stats.hitRate < 0.5 && stats.totalGets > 4) {
          void vscode.window.showWarningMessage(
            vscode.l10n.t('deepseek-pilot.context.cacheLowWarning', summary),
            { modal: false, detail: msg },
          );
        } else {
          void vscode.window.showInformationMessage(summary, { modal: false, detail: msg });
        }
      }),
      vscode.lm.registerLanguageModelChatProvider('deepseek-pilot', provider),
      { dispose: () => provider.dispose() },
    );

    provider.refreshModelPicker();

    void showWelcomeIfNeeded(context, provider).catch((error) => {
      logger.warn('Welcome walkthrough failed', error);
    });

    logger.info(`DeepSeek Pilot activated version=${extVersion}`);
  } catch (error) {
    activeProvider = undefined;
    logger.error('Failed to activate DeepSeek Pilot extension', error);
    void vscode.window.showErrorMessage(vscode.l10n.t('deepseek-pilot.activate.failed'));
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
