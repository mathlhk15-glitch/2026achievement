param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'python-runtime.ps1')
$project = Split-Path $PSScriptRoot -Parent
$python = Find-ExplorerPython
$directory = Join-Path $project 'dist'
$serverScript = Join-Path $PSScriptRoot 'serve.py'
if (-not (Test-Path -LiteralPath (Join-Path $directory 'index.html'))) {
    & $python (Join-Path $PSScriptRoot 'build.py')
    if ($LASTEXITCODE -ne 0) { throw '자료를 준비하지 못했습니다. 자료 갱신을 먼저 실행해 주세요.' }
}
$identity = & $python $serverScript --identity --directory $directory
if ($LASTEXITCODE -ne 0) { throw '탐색기 실행 위치를 확인하지 못했습니다.' }
function Get-ExplorerStatus([int]$port) {
    try { return Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/__explorer_instance__') -TimeoutSec 1 }
    catch { return $null }
}
function Test-LocalPort([int]$port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(250)) { return $false }
        $client.EndConnect($pending)
        return $client.Connected
    } catch { return $false }
    finally { $client.Dispose() }
}
function Save-ExplorerRecord($status, [int]$port) {
    @{ pid = $status.pid; port = $port; instanceId = $status.instanceId } |
        ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $project '.preview.pid') -Encoding ascii
}
foreach ($port in 8870..8889) {
    $url = 'http://127.0.0.1:' + $port + '/'
    $status = Get-ExplorerStatus $port
    if ($status.instanceId -eq $identity) {
        Save-ExplorerRecord $status $port
        if (-not $NoBrowser) { Start-Process $url }
        Write-Host $url
        exit 0
    }
    if (Test-LocalPort $port) { continue }
    $serverProcessId = & $python $serverScript --background --directory $directory --port $port --log-dir $project
    if ($LASTEXITCODE -ne 0 -or -not $serverProcessId) { continue }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 150
        $status = Get-ExplorerStatus $port
        if ($status.instanceId -eq $identity) {
            Save-ExplorerRecord $status $port
            if (-not $NoBrowser) { Start-Process $url }
            Write-Host $url
            exit 0
        }
        if (-not (Get-Process -Id $serverProcessId -ErrorAction SilentlyContinue)) { break }
    }
}
throw '로컬 탐색기를 열지 못했습니다. .preview.stderr.log의 실행 기록을 확인해 주세요.'
