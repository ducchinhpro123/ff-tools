const WINDOWS_DRIVE_ROOT_REGEX = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_ROOT_REGEX = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/;
const WINDOWS_INVALID_CHARS_REGEX = /[<>:"|?*\0\r\n]/;
const POSIX_INVALID_CHARS_REGEX = /[\0\r\n]/;

function isWindowsAbsoluteLogPath(filePath: string): boolean {
  return WINDOWS_DRIVE_ROOT_REGEX.test(filePath) || WINDOWS_UNC_ROOT_REGEX.test(filePath);
}

function isPosixAbsoluteLogPath(filePath: string): boolean {
  return filePath.startsWith("/");
}

export function isAbsoluteLogPath(filePath: string): boolean {
  return isPosixAbsoluteLogPath(filePath) || isWindowsAbsoluteLogPath(filePath);
}

export function isValidLogPath(filePath: string): boolean {
  if (isWindowsAbsoluteLogPath(filePath)) {
    const pathAfterDrive = filePath.replace(/^[A-Za-z]:/, "");
    return !WINDOWS_INVALID_CHARS_REGEX.test(pathAfterDrive);
  }

  if (isPosixAbsoluteLogPath(filePath)) {
    return !POSIX_INVALID_CHARS_REGEX.test(filePath);
  }

  return false;
}
