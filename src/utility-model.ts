import vscode from 'vscode';
import {
  COPILOT_UTILITY_MODEL_SETTING,
  COPILOT_UTILITY_SMALL_MODEL_SETTING,
  MODELS,
} from './consts';
import { logger } from './logger';

/**
 * Wire one of our DeepSeek variants into Copilot Chat's "utility model"
 * setting (introduced in Copilot Chat 1.121). These settings route the
 * background flows — generating titles, summaries, commit messages, rename
 * suggestions, prompt categorization, intent detection — through the chosen
 * model instead of GitHub's defaults. For these flows Flash (non-thinking)
 * is almost always the right choice: low latency, near-zero cost, no
 * benefit from extended reasoning.
 */
export async function setCopilotUtilityModel(
  slot: 'primary' | 'small',
): Promise<void> {
  const recommendedId =
    slot === 'small' ? 'deepseek-v4-flash' : 'deepseek-v4-flash::thinking';

  const items = MODELS.map((m) => ({
    label: m.name,
    description: m.id,
    detail: m.detail,
    modelId: m.id,
    picked: m.id === recommendedId,
  }));

  // Surface Flash first — it's the right choice for utility flows almost
  // always. Pro stays selectable for users who want the strongest model
  // behind summaries and intent detection.
  items.sort((a, b) => (a.modelId.includes('flash') ? -1 : 1) - (b.modelId.includes('flash') ? -1 : 1));

  const picked = await vscode.window.showQuickPick(items, {
    title:
      slot === 'small'
        ? 'Set Copilot Utility Small Model (used for fast, lightweight flows)'
        : 'Set Copilot Utility Model (used for titles, summaries, commits, intent)',
    placeHolder: `Recommended: ${recommendedId}`,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) return;

  const targetSetting =
    slot === 'small' ? COPILOT_UTILITY_SMALL_MODEL_SETTING : COPILOT_UTILITY_MODEL_SETTING;

  // The chat.utilityModel setting expects a fully-qualified model identifier
  // in `vendor/family/id` form (Copilot Chat normalises this when reading).
  // We write the canonical `vendor/id` shape that Copilot Chat documents.
  const value = `deepseek-qa/${picked.modelId}`;

  try {
    await vscode.workspace
      .getConfiguration()
      .update(targetSetting, value, vscode.ConfigurationTarget.Global);
    logger.info(`Set ${targetSetting}=${value}`);
    void vscode.window.showInformationMessage(
      `${slot === 'small' ? 'Utility Small' : 'Utility'} model set to ${picked.label}.`,
      'Open Setting',
    ).then((choice) => {
      if (choice === 'Open Setting') {
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          `@id:${targetSetting}`,
        );
      }
    });
  } catch (e) {
    logger.error(`Failed to set ${targetSetting}`, e);
    void vscode.window.showErrorMessage(
      `Failed to set Copilot utility model: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
