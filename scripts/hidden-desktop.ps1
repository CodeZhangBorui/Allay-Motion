# 在一个用户看不见的 Windows 桌面上启动程序（docs/decisions.md M8“冷启动的测量”）。
# 打包后的应用不认任何测试开关（窗口照常显示），为了不在用户正在用的桌面上弹窗、抢焦点，
# 把它放进同一个窗口站（WinSta0）里另建的桌面：窗口、显卡、输入法都正常工作，只是不在当前桌面上显示。
# 用法：powershell -NoProfile -WindowStyle Hidden -File hidden-desktop.ps1 -Exe <路径> -Seconds <秒> [-ExeArgs <参数>]
# 输出一行 JSON：{"pid":…,"startedAt":"<ISO 时间>"}；到时间后结束整个进程树并关掉桌面。
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][int]$Seconds,
  [string]$ExeArgs = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HiddenDesktop {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr devmode, int flags, uint access, IntPtr sa);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
'@
$name = 'AllayMeasure' + [guid]::NewGuid().ToString('N').Substring(0, 8)
# GENERIC_ALL
$desk = [HiddenDesktop]::CreateDesktop($name, [IntPtr]::Zero, [IntPtr]::Zero, 0, 0x10000000, [IntPtr]::Zero)
if ($desk -eq [IntPtr]::Zero) { throw "CreateDesktop failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
try {
  $si = New-Object HiddenDesktop+STARTUPINFO
  $si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
  $si.lpDesktop = "WinSta0\$name"
  $pi = New-Object HiddenDesktop+PROCESS_INFORMATION
  $cmd = '"' + $Exe + '"'
  if ($ExeArgs) { $cmd = $cmd + " " + $ExeArgs }
  $startedAt = [DateTime]::UtcNow.ToString('o')
  if (-not [HiddenDesktop]::CreateProcess($Exe, $cmd, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, (Split-Path $Exe), [ref]$si, [ref]$pi)) {
    throw "CreateProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  [Console]::Out.WriteLine((@{ pid = $pi.dwProcessId; startedAt = $startedAt } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  [HiddenDesktop]::CloseHandle($pi.hThread) | Out-Null
  [HiddenDesktop]::CloseHandle($pi.hProcess) | Out-Null
  Start-Sleep -Seconds $Seconds
  & taskkill.exe /PID $pi.dwProcessId /T /F 2>&1 | Out-Null
  Start-Sleep -Milliseconds 800
} finally {
  [HiddenDesktop]::CloseDesktop($desk) | Out-Null
}
