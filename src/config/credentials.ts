import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const CRED_PATH = path.join(os.homedir(), "AppData", "Local", "TandemMode", "credentials.dat");
// Nije tajna — samo dodatni ulaz pomešan sa DPAPI ključem vezanim za OS nalog,
// koji je stvarna zaštita.
const ENTROPY = "tandem-mode-v1";

/**
 * DPAPI-šifrovan fajl umesto punog Windows Credential Manager-a — isti
 * mehanizam (samo ovaj OS nalog može dešifrovati), ali direktan .NET poziv
 * bez multi-platform auto-detekcije. `cross-keychain` je probana prva
 * (M2) i odbačena: 15-18s po pozivu na ovoj mašini čak i sa native
 * bindingom, jer njena detekcija backend-a proba sve platforme redom.
 * Linux/macOS ide u good-first-issues, isto obrazloženje kao clipboard.ts.
 *
 * Ključ se ISKLJUČIVO prosleđuje kroz stdin, nikad kroz argumente komande —
 * argumenti su vidljivi u listi procesa (Task Manager i sl.) dok proces traje.
 */
function assertWindows(): void {
  if (process.platform !== "win32") {
    throw new Error("Čuvanje API ključa je trenutno podržano samo na Windows-u.");
  }
}

function runPs(script: string, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`powershell exited with code ${code}: ${stderr.trim()}`));
    });
    if (stdin !== undefined) child.stdin.write(stdin, "utf8");
    child.stdin.end();
  });
}

export async function getStoredApiKey(): Promise<string | null> {
  assertWindows();
  const script = `
Add-Type -AssemblyName System.Security
$path = '${CRED_PATH.replace(/'/g, "''")}'
if (-not (Test-Path $path)) { Write-Output '__NULL__'; exit }
try {
  $protected = [System.IO.File]::ReadAllBytes($path)
  $entropy = [System.Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
  $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [System.Text.Encoding]::UTF8.GetString($bytes)
} catch {
  Write-Output '__NULL__'
}`;
  const result = await runPs(script);
  return result === "__NULL__" || result === "" ? null : result;
}

export async function setStoredApiKey(key: string): Promise<void> {
  assertWindows();
  const dir = path.dirname(CRED_PATH);
  const script = `
Add-Type -AssemblyName System.Security
New-Item -ItemType Directory -Force -Path '${dir.replace(/'/g, "''")}' | Out-Null
$key = [Console]::In.ReadToEnd()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($key)
$entropy = [System.Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[System.IO.File]::WriteAllBytes('${CRED_PATH.replace(/'/g, "''")}', $protected)`;
  await runPs(script, key);
}

export async function deleteStoredApiKey(): Promise<void> {
  assertWindows();
  const script = `
$path = '${CRED_PATH.replace(/'/g, "''")}'
if (Test-Path $path) { Remove-Item $path -Force }`;
  await runPs(script);
}
