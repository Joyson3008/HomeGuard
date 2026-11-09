$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# WinGet may install FFmpeg without refreshing the already-open VS Code PATH.
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    $ffmpeg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg.Shared_*" -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ffmpeg) { $env:Path = "$($ffmpeg.DirectoryName);$env:Path" }
}

# MEGAcmd wrappers may be installed per-user or for all users. Add their folder
# so Python can invoke mega-whoami/mega-put/mega-rm using the saved MEGAcmd session.
$megaRoots = @(
    (Join-Path $env:ProgramFiles 'MEGAcmd'),
    (Join-Path $env:LOCALAPPDATA 'MEGAcmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\MEGAcmd'),
    (Join-Path $env:LOCALAPPDATA 'MEGA\MEGAcmd'),
    (Join-Path ${env:ProgramFiles(x86)} 'MEGAcmd')
) | Where-Object { $_ -and (Test-Path $_) }
foreach ($root in $megaRoots) {
    $megaPut = Get-ChildItem -LiteralPath $root -Filter 'mega-put.bat' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($megaPut) { $env:Path = "$($megaPut.DirectoryName);$env:Path"; break }
}

py .\server.py
