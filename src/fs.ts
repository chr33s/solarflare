import { access } from "node:fs/promises";

/** Node.js file system helpers. */
export async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
