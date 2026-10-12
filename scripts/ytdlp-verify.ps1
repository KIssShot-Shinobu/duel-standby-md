# Skrip bantu pengembangan: memverifikasi yt-dlp + selector format yang dipakai bot.
# Memakai `python -m yt_dlp` (tidak butuh Node).
#   powershell -ExecutionPolicy Bypass -File scripts/ytdlp-verify.ps1 -PyLib tmp/pylib
param(
  [string]$Url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  [string]$PyLib = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

if ($PyLib -and (Test-Path $PyLib)) { $env:PYTHONPATH = (Resolve-Path $PyLib).Path }

$base = @('--no-playlist', '--no-warnings', '--no-progress', '--no-part', '--retries', '3', '--socket-timeout', '25', '--no-mtime')
$audioSelector = 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best'
$videoProgressive = 'b[ext=mp4][height<=720]/b[height<=720]/b'
$videoMerge = 'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/bv*[height<=720]+ba/b[height<=720]/b'

Write-Host '=== versi yt-dlp ==='
python -m yt_dlp --version

Write-Host "`n=== metadata (dipakai .ytmp3/.ytmp4 untuk judul & durasi) ==="
$json = python -m yt_dlp @base --dump-single-json --skip-download $Url 2>&1 | Select-Object -Last 1
if ($json) {
  try {
    $parsed = $json | ConvertFrom-Json
    "judul   : $($parsed.title)"
    "durasi  : $($parsed.duration) detik"
    "uploader: $($parsed.uploader)"
  } catch {
    "gagal parse JSON: $($json.Substring(0, [Math]::Min(200, $json.Length)))"
  }
}

New-Item -ItemType Directory -Force -Path tmp | Out-Null
Remove-Item tmp\audio-test.*, tmp\video-test.* -ErrorAction SilentlyContinue

Write-Host "`n=== audio (selector .ytmp3, tanpa ffmpeg) ==="
python -m yt_dlp @base -f $audioSelector -o 'tmp/audio-test.%(ext)s' $Url 2>&1 | Select-Object -Last 2
Get-ChildItem tmp\audio-test.* -ErrorAction SilentlyContinue | Select-Object Name, Length

Write-Host "`n=== video progressive (selector .ytmp4 kalau ffmpeg TIDAK ada) ==="
python -m yt_dlp @base -f $videoProgressive -o 'tmp/video-test.%(ext)s' $Url 2>&1 | Select-Object -Last 2
Get-ChildItem tmp\video-test.* -ErrorAction SilentlyContinue | Select-Object Name, Length

Write-Host "`n=== validitas selector merge (dipakai kalau ffmpeg ADA) ==="
python -m yt_dlp @base -f $videoMerge --simulate --print '%(format_id)s %(ext)s %(height)s' $Url 2>&1 | Select-Object -Last 3
