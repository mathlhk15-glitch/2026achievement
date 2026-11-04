$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'python-runtime.ps1')
$project = Split-Path $PSScriptRoot -Parent
$recordPath = Join-Path $project '.preview.pid'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Host '종료할 탐색기 실행 기록이 없습니다.'; exit 0 }
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
if (-not $record.port -or -not $record.instanceId) { Write-Host '이전 버전의 실행 기록입니다. 이 종료 파일에서는 해당 프로세스를 종료하지 않습니다.'; exit 0 }
$python = Find-ExplorerPython
$identity = & $python (Join-Path $PSScriptRoot 'serve.py') --identity --directory (Join-Path $project 'dist')
try { $status = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $record.port + '/__explorer_instance__') -TimeoutSec 2 }
catch { Write-Host '탐색기가 이미 종료되어 있습니다.'; exit 0 }
if ($status.instanceId -ne $identity -or $status.instanceId -ne $record.instanceId -or $status.pid -ne $record.pid) {
    throw '실행 기록과 현재 프로그램이 달라 종료하지 않았습니다.'
}
$serverProcess = Get-Process -Id $status.pid -ErrorAction Stop
if ($serverProcess.Path -ne $python) { throw '실행 파일이 달라 종료하지 않았습니다.' }
Stop-Process -Id $serverProcess.Id -ErrorAction Stop
Remove-Item -LiteralPath $recordPath
Write-Host '이 폴더에서 실행한 탐색기를 종료했습니다. 브라우저 탭도 닫아 주세요.'
