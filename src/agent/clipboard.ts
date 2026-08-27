import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Samo Windows za sada — Linux/macOS clipboard pristup ide u good-first-issues
 * (xclip/pngpaste), u duhu "Windows first-class" principa iz plana.
 */
export async function saveClipboardImage(destPath: string): Promise<boolean> {
  if (process.platform !== "win32") {
    throw new Error("Clipboard paste slike je trenutno podržan samo na Windows-u.");
  }

  const escapedPath = destPath.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
  $img = [System.Windows.Forms.Clipboard]::GetImage()
  $img.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "OK"
} else {
  Write-Output "NO_IMAGE"
}`;

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  return stdout.trim() === "OK";
}
