// Minimal stand-in for the parts of the `vscode` API the unit-tested modules
// touch. request-kind.ts needs the message-role enum (note the real enum has no
// `System` member — the host delivers a numeric 3) and the text-part class used
// in `instanceof` checks.
export class LanguageModelTextPart {
  constructor(public readonly value: string) {}
}

// convert.ts instanceof-checks these three during request preparation.
export class LanguageModelDataPart {
  constructor(
    public readonly data: Uint8Array,
    public readonly mimeType: string,
  ) {}

  static image(data: Uint8Array, mime: string): LanguageModelDataPart {
    return new LanguageModelDataPart(data, mime);
  }
}

// view-image.ts returns tool results; tests inspect their content array.
export class LanguageModelToolResult {
  constructor(public readonly content: unknown[]) {}
}

export class CancellationError extends Error {}

export class LanguageModelToolCallPart {
  constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly input: object,
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(
    public readonly callId: string,
    public readonly content: unknown[],
  ) {}
}

export const LanguageModelChatMessageRole = { User: 1, Assistant: 2 } as const;

// request.ts maps the host's tool mode onto DeepSeek's tool_choice.
export const LanguageModelChatToolMode = { Auto: 1, Required: 2 } as const;

// logger.ts constructs its output channel at module scope, so importing any
// module that reaches it (stream.ts does) needs `window` to exist.
export const window = {
  createOutputChannel: () => ({
    appendLine: () => {},
    append: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
    replace: () => {},
    name: 'DeepSeek Pilot',
  }),
};

export const workspace = {
  // Honors the caller-supplied default, matching the real API's behavior
  // when a setting is unset. `workspaceFolders` is mutable so tests can
  // stand in a temp directory for relative-path resolution.
  getConfiguration: () => ({ get: (_key: string, def?: unknown) => def }),
  workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
};

// view-image.ts localizes its progress message; identity-substitute {0}.
export const l10n = {
  t: (message: string, ...args: unknown[]) =>
    message.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? '')),
};

export default {
  LanguageModelTextPart,
  LanguageModelDataPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
  LanguageModelToolResult,
  LanguageModelChatMessageRole,
  LanguageModelChatToolMode,
  CancellationError,
  window,
  workspace,
  l10n,
};
