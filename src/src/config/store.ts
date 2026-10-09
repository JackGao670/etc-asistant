import * as vscode from "vscode";
import { profileSchema, type Profile } from "../../shared/config";
import { SessionManager } from "../session/session";
import { t } from "../i18n";

export class ProfileStore {
  profile: Profile = { version: 1, connections: [], commands: [] };
  private revisions = new Map<string, string | null>();
  constructor(private context: vscode.ExtensionContext, private manager: SessionManager) {}
  snapshot(): Profile {
    return { version: 1, connections: [...this.manager.sessions.values()].map(s => ({
      id: s.id, name: s.name, config: s.config
    })), commands: this.profile.commands };
  }
  private async folder() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return undefined;
    if (folders.length === 1) return folders[0];
    const selected = await vscode.window.showQuickPick(folders.map(folder => ({ label: folder.name, folder })), {
      title: t("folderDialog")
    });
    if (!selected) throw new Error(t("cancelled")); return selected.folder;
  }
  private async read(uri: vscode.Uri): Promise<string | null> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > 4 * 1024 * 1024) throw new Error(t("configLimit"));
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return null;
      throw error;
    }
  }
  async load() {
    const folder = await this.folder();
    let profile: Profile;
    if (folder) {
      const uri = vscode.Uri.joinPath(folder.uri, ".vscode", "ect.json");
      const text = await this.read(uri);
      if (text === null) throw new Error(t("configMissing"));
      profile = profileSchema.parse(JSON.parse(text)); this.revisions.set(uri.toString(), text);
    } else profile = profileSchema.parse(this.context.globalState.get("ect.profile", { version: 1, connections: [], commands: [] }));
    if ([...this.manager.sessions.values()].some(s => s.dto().status !== "closed")) {
      throw new Error(t("configClose"));
    }
    for (const id of [...this.manager.sessions.keys()]) await this.manager.remove(id);
    for (const item of profile.connections) this.manager.create(item.config, item.name, item.id);
    this.profile = profile;
  }
  async save() {
    const profile = profileSchema.parse(this.snapshot());
    const folder = await this.folder();
    if (!folder) { await this.context.globalState.update("ect.profile", profile); return; }
    const uri = vscode.Uri.joinPath(folder.uri, ".vscode", "ect.json");
    const current = await this.read(uri);
    const known = this.revisions.get(uri.toString());
    if (current !== null && (known === undefined || current !== known)) {
      const button = t("overwrite");
      const confirm = await vscode.window.showWarningMessage(t("overwriteWarning"),
        { modal: true }, button);
      if (confirm !== button) throw new Error(t("notOverwritten"));
    }
    const text = JSON.stringify(profile, null, 2) + "\n";
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".vscode"));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text));
    this.revisions.set(uri.toString(), text); this.profile = profile;
  }
}
