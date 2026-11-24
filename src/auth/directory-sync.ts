/** File fsync is mandatory at the caller. Directory fsync is a separate crash
 * durability capability: Windows/libuv (and some filesystems) do not support it.
 * No file, rename, chmod, disk-full or generic access error is ignored here. */
import { openSync, fsyncSync, closeSync } from "node:fs";
export interface DirectorySyncIO {
  open: (path: string) => number;
  sync: (fd: number) => void;
  close: (fd: number) => void;
  warn: () => void;
}
let warned = false;
const io: DirectorySyncIO = {
  open: (path) => openSync(path, "r"),
  sync: (fd) => fsyncSync(fd),
  close: closeSync,
  warn: () => {
    if (!warned) {
      warned = true;
      process.emitWarning(
        "Directory fsync is unavailable on this platform/filesystem; credential files are fsynced and atomically renamed, but power-loss durability of directory entries is not guaranteed.",
        { code: "ANTIGRAVITY_DIRECTORY_FSYNC_UNAVAILABLE" },
      );
    }
  },
};
const code = (e: unknown): string =>
  e !== null && typeof e === "object" && "code" in e ? String(e.code) : "";
export function syncCredentialDirectory(
  path: string,
  ops: DirectorySyncIO = io,
  platform: NodeJS.Platform = process.platform,
): "synced" | "unsupported" {
  let fd: number;
  try {
    fd = ops.open(path);
  } catch (e) {
    if (
      platform !== "win32" ||
      !["EPERM", "EISDIR", "EINVAL", "ENOTSUP", "ENOSYS"].includes(code(e))
    )
      throw e;
    ops.warn();
    return "unsupported";
  }
  try {
    try {
      ops.sync(fd);
    } catch (e) {
      const unsupported =
        ["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(code(e)) ||
        (platform === "win32" && code(e) === "EPERM");
      if (!unsupported) throw e;
      ops.warn();
      return "unsupported";
    }
    return "synced";
  } finally {
    ops.close(fd);
  }
}
