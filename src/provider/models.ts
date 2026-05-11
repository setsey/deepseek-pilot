import vscode from 'vscode';
import { MODELS } from '../consts';

export function toChatInfo(
  model: (typeof MODELS)[number],
  hasKey: boolean,
): vscode.LanguageModelChatInformation {
  // The @types/vscode version may lag behind the runtime API.
  // Fields like vendor, capabilities, maxInputTokens exist at runtime
  // in VS Code 1.116+ even if the type definitions don't include them.
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    ...(hasKey
      ? {}
      : {
          isUserSelectable: false,
          // description is a custom field set by some provider implementations
        }),
  } as unknown as vscode.LanguageModelChatInformation;
}
