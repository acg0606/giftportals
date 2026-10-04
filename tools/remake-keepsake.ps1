param(
    [Parameter(Mandatory=$true)][ValidateSet('create','poll','approve','reject')][string]$Action,
    [string]$SourceJobId,
    [string]$JobId,
    [string]$DedupeKey,
    [string]$ReferenceSha,
    [string]$MiniatureReference,
    [switch]$PauseAfterReference,
    [switch]$ConfirmProviderSpend,
    [switch]$UseProtectedVault,
    [string]$ProviderVault = 'C:\Users\admin\Documents\Codex\2026-09-30\com\work\tripothon-benefits\credential-vault'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskNode = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$taskNames = @('TRIPO_API_KEY','WORLD_LABS_API_KEY','ENABLE_LOCAL_GENERATION','LOCAL_WORLDLABS_CREDIT_CAP','LOCAL_TRIPO_CREDIT_CAP','WORLDLABS_MODEL')
$taskPrevious = @{}
try {
    if ($Action -in @('create','approve') -and -not $ConfirmProviderSpend) { throw 'Explicit provider spend confirmation is required.' }
    foreach ($taskName in $taskNames) { $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName,'Process') }
    if ($UseProtectedVault -and $Action -ne 'reject') {
        foreach ($taskProvider in @('tripo','worldlabs')) {
            $taskName = if ($taskProvider -eq 'tripo') { 'TRIPO_API_KEY' } else { 'WORLD_LABS_API_KEY' }
            if (-not [string]::IsNullOrWhiteSpace($taskPrevious[$taskName])) { continue }
            $taskFile = Join-Path $ProviderVault ($taskProvider + '.dpapi')
            if (-not (Test-Path -LiteralPath $taskFile)) { throw 'A protected provider key is unavailable.' }
            $taskPointer = [IntPtr]::Zero
            $taskSecret = $null
            try {
                $taskSecret = ConvertTo-SecureString -String (Get-Content -LiteralPath $taskFile -Raw)
                $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret)
                [Environment]::SetEnvironmentVariable($taskName,[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer),'Process')
            } finally {
                if ($taskPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
                if ($null -ne $taskSecret) { $taskSecret.Dispose() }
            }
        }
        [Environment]::SetEnvironmentVariable('ENABLE_LOCAL_GENERATION','true','Process')
        [Environment]::SetEnvironmentVariable('LOCAL_WORLDLABS_CREDIT_CAP','15000','Process')
        [Environment]::SetEnvironmentVariable('LOCAL_TRIPO_CREDIT_CAP','1500','Process')
        [Environment]::SetEnvironmentVariable('WORLDLABS_MODEL','marble-1.1','Process')
    }
    $taskArguments = @((Join-Path $PSScriptRoot 'remake-keepsake.mjs'),'--action',$Action)
    foreach ($taskPair in @(@('--source',$SourceJobId),@('--job',$JobId),@('--dedupe-key',$DedupeKey),@('--reference-sha',$ReferenceSha),@('--miniature-reference',$MiniatureReference))) {
        if (-not [string]::IsNullOrWhiteSpace($taskPair[1])) { $taskArguments += $taskPair }
    }
    if ($PauseAfterReference) { $taskArguments += '--pause-after-reference' }
    if ($ConfirmProviderSpend) { $taskArguments += '--confirm-provider-spend' }
    Push-Location -LiteralPath $taskProject
    try { & $taskNode @taskArguments; $taskExit = $LASTEXITCODE } finally { Pop-Location }
    exit $taskExit
} catch {
    [Console]::Error.WriteLine('The controlled remake could not run. No credential values were output.')
    exit 1
} finally {
    foreach ($taskName in $taskNames) { if ($taskPrevious.ContainsKey($taskName)) { [Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process') } }
}
