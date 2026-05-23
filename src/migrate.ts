import vscode from 'vscode';
import { logger } from './logger';

/**
 * One-shot migration from the previous `deepseek-qa.*` namespace (extension
 * name "deepseek-v4-qa") to the new `deepseek-pilot.*` namespace.
 *
 * What we migrate:
 *   - The secret API key (OS keychain).
 *   - The persistent reasoning cache (globalState).
 *   - The "welcome walkthrough shown" flag.
 *   - User settings under `deepseek-qa.*` → copied to `deepseek-pilot.*`
 *     when the new key has no explicit value.
 *
 * Idempotent: tracks completion via `deepseek-pilot.migratedFromDeepseekQa`
 * so it only runs once per profile. Failures are logged but never throw —
 * they don't block activation.
 */
const MIGRATION_FLAG_KEY = 'deepseek-pilot.migratedFromDeepseekQa';
const OLD_SECRET_KEY = 'deepseek-qa.apiKey';
const NEW_SECRET_KEY = 'deepseek-pilot.apiKey';
const OLD_REASONING_KEY = 'deepseek-qa.reasoningCache';
const NEW_REASONING_KEY = 'deepseek-pilot.reasoningCache';
const OLD_WELCOME_KEY = 'deepseek-qa.welcomeShown';
const NEW_WELCOME_KEY = 'deepseek-pilot.welcomeShown';

const SETTINGS_TO_MIGRATE = [
  'baseUrl',
  'maxTokens',
  'reasoningEffort',
  'debug',
  'modelIdOverrides',
  'visionModel',
  'visionPrompt',
  'applyProDiscount',
  'contextWarnThreshold',
  'contextCriticalThreshold',
] as const;

export async function migrateFromDeepseekQa(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(MIGRATION_FLAG_KEY)) return;

  let migratedSomething = false;

  // 1. Secret API key — copy then delete the old one so the OS keychain
  //    doesn't end up with two entries for the same value.
  try {
    const oldKey = await context.secrets.get(OLD_SECRET_KEY);
    if (oldKey) {
      const newKey = await context.secrets.get(NEW_SECRET_KEY);
      if (!newKey) {
        await context.secrets.store(NEW_SECRET_KEY, oldKey);
        logger.info('migration: copied API key deepseek-qa.apiKey → deepseek-pilot.apiKey');
        migratedSomething = true;
      }
      await context.secrets.delete(OLD_SECRET_KEY);
    }
  } catch (e) {
    logger.warn('migration: API key copy failed', e);
  }

  // 2. Reasoning cache.
  try {
    const oldCache = context.globalState.get(OLD_REASONING_KEY);
    if (Array.isArray(oldCache) && oldCache.length > 0) {
      const newCache = context.globalState.get(NEW_REASONING_KEY);
      if (!Array.isArray(newCache) || newCache.length === 0) {
        await context.globalState.update(NEW_REASONING_KEY, oldCache);
        logger.info(
          `migration: copied ${oldCache.length} reasoning cache entries deepseek-qa → deepseek-pilot`,
        );
        migratedSomething = true;
      }
      await context.globalState.update(OLD_REASONING_KEY, undefined);
    }
  } catch (e) {
    logger.warn('migration: reasoning cache copy failed', e);
  }

  // 3. Welcome walkthrough flag.
  try {
    const oldWelcome = context.globalState.get<boolean>(OLD_WELCOME_KEY);
    if (oldWelcome) {
      await context.globalState.update(NEW_WELCOME_KEY, true);
      await context.globalState.update(OLD_WELCOME_KEY, undefined);
    }
  } catch (e) {
    logger.warn('migration: welcome flag copy failed', e);
  }

  // 4. User settings — copy per-setting only when the new namespace has no
  //    explicit value. Targets Global scope: workspace overrides keep their
  //    own values intact.
  try {
    const oldCfg = vscode.workspace.getConfiguration('deepseek-qa');
    const newCfg = vscode.workspace.getConfiguration('deepseek-pilot');
    for (const setting of SETTINGS_TO_MIGRATE) {
      const oldInspect = oldCfg.inspect(setting);
      const oldValue = oldInspect?.globalValue;
      if (oldValue === undefined) continue;
      const newInspect = newCfg.inspect(setting);
      if (newInspect?.globalValue !== undefined) continue;
      await newCfg.update(setting, oldValue, vscode.ConfigurationTarget.Global);
      logger.info(`migration: copied setting deepseek-qa.${setting} → deepseek-pilot.${setting}`);
      migratedSomething = true;
    }
  } catch (e) {
    logger.warn('migration: settings copy failed', e);
  }

  await context.globalState.update(MIGRATION_FLAG_KEY, true);

  if (migratedSomething) {
    void vscode.window.showInformationMessage(
      'DeepSeek Pilot: migrated your existing API key and settings from the previous extension namespace. Old entries cleaned up.',
    );
  }
}
