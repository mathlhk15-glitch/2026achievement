$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'python-runtime.ps1')
$project = Split-Path $PSScriptRoot -Parent
$parentFolder = Split-Path $project -Parent
$python = Find-ExplorerPython
# Keep the original workspace usable: newly created sibling documents are copied,
# while all source documents inside this project remain available for GitHub.
if (Test-Path -LiteralPath (Join-Path $parentFolder '성취기준및교과서목차탐색기.html')) {
    Get-ChildItem -LiteralPath $parentFolder -Filter '*.docx' -File |
        Where-Object { $_.Name -notlike '~$*' } |
        Copy-Item -Destination (Join-Path $project 'source-docs') -Force
}
$additionalFolder = Join-Path $parentFolder '추가 탐구'
if (Test-Path -LiteralPath $additionalFolder) {
    $additionalDestination = Join-Path $project 'source-docs\추가 탐구'
    Get-ChildItem -LiteralPath $additionalFolder -Filter '*.docx' -File -Recurse |
        Where-Object { $_.Name -notlike '~$*' } |
        ForEach-Object {
            $relative = $_.FullName.Substring($additionalFolder.Length).TrimStart([char[]]'\/')
            $destination = Join-Path $additionalDestination $relative
            New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
        }
}
& $python (Join-Path $PSScriptRoot 'build.py')
if ($LASTEXITCODE -ne 0) { throw '자료 갱신에 실패했습니다. 이전 결과는 유지됩니다. reports 폴더의 보고서를 확인하세요.' }
& $python (Join-Path $PSScriptRoot 'validate.py')
if ($LASTEXITCODE -ne 0) { throw '자료 검증에 실패했습니다. 보고서를 확인해 주세요.' }
Write-Host '자료 갱신을 마쳤습니다. 열려 있는 탐색기는 새로고침해 주세요.' -ForegroundColor Green
