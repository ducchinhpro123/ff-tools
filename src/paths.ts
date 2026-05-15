import path from "node:path";

export const projectRoot = path.resolve(process.env.FF_TOOLS_APP_ROOT || process.cwd());
export const dataRoot = path.resolve(process.env.FF_TOOLS_DATA_DIR || projectRoot);
export const configDir = path.join(dataRoot, "config");
export const teamsCsvPath = path.join(configDir, "teams.csv");
export const overlayConfigPath = path.join(configDir, "overlay.json");
export const groupsDataPath = path.join(configDir, "groups.json");
export const playersDataPath = path.join(configDir, "players.json");
export const assetsDir = path.join(projectRoot, "assets");
export const publicDir = path.join(projectRoot, "dist", "public");

export function assetUrl(filePath: string): string {
  if (!filePath) return "";
  return filePath.replace(/\\/g, "/").replace(/^assets\//, "/assets/");
}
