param([string]$ProviderVault='C:\Users\admin\Documents\Codex\2026-09-30\com\work\tripothon-benefits\credential-vault')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$taskPrevious=@{}
try {
  foreach($taskProvider in @('tripo','worldlabs')) {
    $taskName=if($taskProvider -eq 'tripo'){'TRIPO_API_KEY'}else{'WORLD_LABS_API_KEY'}
    $taskPrevious[$taskName]=[Environment]::GetEnvironmentVariable($taskName,'Process')
    $taskFile=Join-Path $ProviderVault ($taskProvider+'.dpapi')
    $taskPointer=[IntPtr]::Zero; $taskSecret=$null
    try {
      $taskSecret=ConvertTo-SecureString -String (Get-Content -LiteralPath $taskFile -Raw)
      $taskPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
      [Environment]::SetEnvironmentVariable($taskName,[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer),'Process')
    } finally {
      if($taskPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)}
      if($null -ne $taskSecret){$taskSecret.Dispose()}
    }
  }
  Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
  try { & node 'tools/package-public-gallery-preview.mjs'; $taskExit=$LASTEXITCODE } finally { Pop-Location }
  exit $taskExit
} catch { [Console]::Error.WriteLine('Preview packaging failed. No credential values were output.'); exit 1 }
finally { foreach($taskName in $taskPrevious.Keys){[Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process')} }
