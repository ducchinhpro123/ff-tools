import path from "node:path";

export const projectRoot = process.cwd();
export const configDir = path.join(projectRoot, "config");
export const teamsCsvPath = path.join(configDir, "teams.csv");
export const overlayConfigPath = path.join(configDir, "overlay.json");
export const groupsDataPath = path.join(configDir, "groups.json");
export const playersDataPath = path.join(configDir, "players.json");
export const publicDir = path.join(projectRoot, "dist", "public");

export function assetUrl(filePath: string): string {
  if (!filePath) return "";
  return filePath.replace(/\\/g, "/").replace(/^assets\//, "/assets/");
}
