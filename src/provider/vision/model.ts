import vscode from 'vscode';
import { getVisionModelSetting } from '../../config';
import { logger } from '../../logger';

/**
 * Creates a vision model getter. Returns the user-configured vision proxy
 * model as a LanguageModelChatInformation object. Since selectChatModels
 * is not available in this VS Code API version, we use the setting directly.
 */
export function createVisionModelGetter(): {
  get: () => Promise<vscode.LanguageModelChatInformation | null>;
  reset: () => void;
} {
  let cached: vscode.LanguageModelChatInformation | null = null;

  return {
    get: async () => {
      if (cached !== null) return cached;

      const settingId = getVisionModelSetting();
      if (!settingId) {
        cached = null;
        return null;
      }

      cached = {
        id: settingId,
        name: settingId,
        family: settingId,
      } as vscode.LanguageModelChatInformation;

      logger.info(`Vision proxy model: ${settingId}`);
      return cached;
    },

    reset: () => {
      cached = null;
    },
  };
}

const KNOWN_VISION_MODELS = [
  { id: 'copilot:gpt-4o', label: 'GPT-4o', description: 'OpenAI vision model via Copilot' },
  { id: 'copilot:claude-sonnet-4', label: 'Claude Sonnet 4', description: 'Anthropic vision model via Copilot' },
  { id: 'copilot:gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google vision model via Copilot' },
];

export async function setVisionProxyModel(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    KNOWN_VISION_MODELS.map((m) => ({
      label: m.label,
      description: m.description,
      detail: m.id,
    })),
    {
      title: 'Select Vision Proxy Model',
      placeHolder: 'Choose a model to describe images before sending to DeepSeek',
    },
  );

  if (!picked) return;

  const model = KNOWN_VISION_MODELS.find((m) => m.label === picked.label);
  if (!model) return;

  await vscode.workspace
    .getConfiguration('deepseek-qa')
    .update('visionModel', model.id, vscode.ConfigurationTarget.Global);

  vscode.window.showInformationMessage(`Vision proxy model set to: ${model.label}`);
}
