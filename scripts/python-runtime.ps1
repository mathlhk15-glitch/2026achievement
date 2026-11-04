$ErrorActionPreference = 'Stop'
function Find-ExplorerPython {
    $bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundled) { return $bundled }
    foreach ($name in @('python', 'py', 'python3')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) {
            try {
                $resolved = & $command.Source -c 'import sys; assert sys.version_info >= (3, 10); print(sys.executable)' 2>$null
                $executable = ($resolved | Select-Object -Last 1)
                if ($LASTEXITCODE -eq 0 -and $executable -and (Test-Path -LiteralPath $executable)) { return $executable }
            } catch { continue }
        }
    }
    throw 'Python 3.10 이상이 필요합니다. https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행해 주세요.'
}
