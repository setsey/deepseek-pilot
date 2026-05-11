import vscode from 'vscode';
import { MODELS } from '../consts';

type RuntimeLanguageModelChatCapabilities = vscode.LanguageModelChatCapabilities & {
  editTools?: readonly string[];
};

type RuntimeLanguageModelChatInformation = vscode.LanguageModelChatInformation & {
  isUserSelectable?: boolean;
  capabilities: RuntimeLanguageModelChatCapabilities;
};

export function toChatInfo(
  model: (typeof MODELS)[number],
  hasKey: boolean,
): vscode.LanguageModelChatInformation {
  const info: RuntimeLanguageModelChatInformation = {
    id: model.id,
    name: model.name,
    family: model.family,
    version: model.version,
    tooltip: model.description,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    isUserSelectable: hasKey,
    capabilities: {
      imageInput: false,
      toolCalling: true,
    },
  };

  return info;
}
