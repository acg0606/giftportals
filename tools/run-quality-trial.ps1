param(
 [Parameter(Mandatory=$true)][ValidateSet('balance','miniature','world')][string]$Kind,
 [ValidateSet('create','poll','approve','reject')][string]$Action='poll',
 [string]$TrialId,
 [string[]]$ToolArguments=@(),
 [switch]$ConfirmProviderSpend,
 [ValidateRange(1,2147483647)][int]$WorldLabsCreditCap=2147483647,
 [ValidateRange(1,2147483647)][int]$TripoCreditCap=2147483647,
 [switch]$UseProtectedVault,
 [string]$ProviderVault='C:\Users\admin\Documents\Codex\2026-09-30\com\work\tripothon-benefits\credential-vault'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$taskProject=Split-Path -Parent $PSScriptRoot
$taskNode='C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$taskNames=@('TRIPO_API_KEY','WORLD_LABS_API_KEY','LOCAL_WORLDLABS_CREDIT_CAP','LOCAL_TRIPO_CREDIT_CAP','GIFTPORTALS_LOCAL_DIR')
$taskPrevious=@{}
try {
 if($Kind -ne 'balance' -and $Action -in @('create','approve') -and -not $ConfirmProviderSpend){throw 'Spend confirmation is required.'}
 foreach($taskName in $taskNames){$taskPrevious[$taskName]=[Environment]::GetEnvironmentVariable($taskName,'Process')}
 if($UseProtectedVault){
  foreach($taskProvider in @('tripo','worldlabs')){
   $taskName=if($taskProvider -eq 'tripo'){'TRIPO_API_KEY'}else{'WORLD_LABS_API_KEY'}
   if(-not [string]::IsNullOrWhiteSpace($taskPrevious[$taskName])){continue}
   $taskFile=Join-Path $ProviderVault ($taskProvider+'.dpapi')
   if(-not (Test-Path -LiteralPath $taskFile)){throw 'A protected provider key is unavailable.'}
   $taskPointer=[IntPtr]::Zero;$taskSecret=$null
   try{$taskSecret=ConvertTo-SecureString -String (Get-Content -LiteralPath $taskFile -Raw);$taskPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecret);[Environment]::SetEnvironmentVariable($taskName,[Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer),'Process')}
   finally{if($taskPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)};if($null -ne $taskSecret){$taskSecret.Dispose()}}
  }
 }
 [Environment]::SetEnvironmentVariable('LOCAL_WORLDLABS_CREDIT_CAP',[string]$WorldLabsCreditCap,'Process')
 [Environment]::SetEnvironmentVariable('LOCAL_TRIPO_CREDIT_CAP',[string]$TripoCreditCap,'Process')
 [Environment]::SetEnvironmentVariable('GIFTPORTALS_LOCAL_DIR',(Join-Path $taskProject '.local-giftportals'),'Process')
 $taskTool=switch($Kind){'balance'{'quality-trial-balances.mjs'}'miniature'{'multiview-keepsake-trial.mjs'}'world'{'world-quality-trial.mjs'}}
 $taskArgs=@((Join-Path $PSScriptRoot $taskTool))
 if($Kind -ne 'balance'){$taskArgs+=@('--action',$Action);if(-not($Kind -eq 'world' -and $Action -eq 'create')){$taskArgs+=@('--trial',$TrialId)};$taskArgs+=$ToolArguments;if($ConfirmProviderSpend){$taskArgs+='--confirm-provider-spend'}}
 Push-Location -LiteralPath $taskProject
 try{& $taskNode @taskArgs;$taskExit=$LASTEXITCODE}finally{Pop-Location}
 exit $taskExit
}catch{[Console]::Error.WriteLine('The quality trial could not run. No credential values were output.');exit 1}
finally{foreach($taskName in $taskNames){if($taskPrevious.ContainsKey($taskName)){[Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process')}}}
