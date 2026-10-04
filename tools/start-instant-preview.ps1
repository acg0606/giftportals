param(
    [int]$Port = 4325,
    [string]$ProviderVault = 'C:\Users\admin\Documents\Codex\2026-09-30\com\work\tripothon-benefits\credential-vault',
    [switch]$UseProtectedVault
)
$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskNode = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$taskPrevious = @{}
$taskNames = @('TRIPO_API_KEY','WORLD_LABS_API_KEY','ENABLE_LOCAL_GENERATION','LOCAL_WORLDLABS_CREDIT_CAP','LOCAL_TRIPO_CREDIT_CAP','WORLDLABS_MODEL')
try {
    foreach ($taskName in $taskNames) { $taskPrevious[$taskName] = [Environment]::GetEnvironmentVariable($taskName,'Process') }
    if ($UseProtectedVault) {
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
    Write-Host ('GiftPortals local preview: http://127.0.0.1:' + $Port + '/#/home')
    Push-Location -LiteralPath $taskProject
    try { & $taskNode (Join-Path $taskProject 'node_modules/vite/bin/vite.js') --host 127.0.0.1 --port $Port --strictPort } finally { Pop-Location }
} catch {
    [Console]::Error.WriteLine('The local preview could not start with its protected provider configuration. No credential values were output.')
    exit 1
} finally {
    foreach ($taskName in $taskNames) { [Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process') }
}
