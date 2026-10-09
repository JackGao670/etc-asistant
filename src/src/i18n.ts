import * as vscode from "vscode";
import { resolveLanguage, translate, type TranslationKey } from "../shared/i18n";

export function language() {
  return resolveLanguage(vscode.workspace.getConfiguration("ect").get<string>("language", "auto"), vscode.env.language);
}
export function t(key: TranslationKey, ...args: Array<string | number>) {
  return translate(language(), key, ...args);
}
