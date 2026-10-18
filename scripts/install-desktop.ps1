$ErrorActionPreference = 'Stop'
$orbitRoot = Split-Path -Parent $PSScriptRoot
$orbitBin = Join-Path $orbitRoot 'bin'
New-Item -ItemType Directory -Path $orbitBin -Force | Out-Null

# Draw the ORBIT mark at native icon sizes; no network or extra packages needed.
Add-Type -AssemblyName System.Drawing
$orbitFrames = @()
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.ScaleTransform(($size / 256.0), ($size / 256.0))
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tile.AddArc(8, 8, 64, 64, 180, 90)
    $tile.AddArc(184, 8, 64, 64, 270, 90)
    $tile.AddArc(184, 184, 64, 64, 0, 90)
    $tile.AddArc(8, 184, 64, 64, 90, 90)
    $tile.CloseFigure()
    $background = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(16, 23, 18))
    $border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(52, 70, 41), 3)
    $lime = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(193, 249, 113), 10)
    $soft = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(139, 185, 80), 8)
    $dot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(215, 255, 162))
    $graphics.FillPath($background, $tile)
    $graphics.DrawPath($border, $tile)
    $graphics.TranslateTransform(128, 128)
    $graphics.RotateTransform(-38)
    $graphics.DrawEllipse($lime, -96, -43, 192, 86)
    $graphics.RotateTransform(82)
    $graphics.DrawEllipse($soft, -90, -44, 180, 88)
    $graphics.FillEllipse($dot, -13, -13, 26, 26)
    $graphics.FillEllipse($dot, 70, -27, 19, 19)
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $orbitFrames += ,@{Size=$size; Bytes=$stream.ToArray()}
    if ($size -eq 256) { $bitmap.Save((Join-Path $orbitBin 'orbit-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
    $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    $tile.Dispose(); $background.Dispose(); $border.Dispose(); $lime.Dispose(); $soft.Dispose(); $dot.Dispose()
}
$orbitIcon = Join-Path $orbitBin 'orbit.ico'
$iconStream = [System.IO.File]::Create($orbitIcon)
$writer = New-Object System.IO.BinaryWriter($iconStream)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$orbitFrames.Count)
    $offset = 6 + 16 * $orbitFrames.Count
    foreach ($frame in $orbitFrames) {
        $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
        $offset += $frame.Bytes.Length
    }
    foreach ($frame in $orbitFrames) { $writer.Write([byte[]]$frame.Bytes) }
} finally { $writer.Dispose(); $iconStream.Dispose() }

$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework compiler not found.' }
$orbitExe = Join-Path $orbitBin 'ORBIT.exe'
& $compiler /nologo /target:winexe /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll "/win32icon:$orbitIcon" "/out:$orbitExe" (Join-Path $orbitRoot 'launcher\OrbitLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'ORBIT launcher compilation failed.' }

# Use Unicode code points so Windows PowerShell also reads UTF-8 source without BOM.
$orbitLabel = 'ORBIT ' + [char]0x81EA + [char]0x5A92 + [char]0x4F53 + [char]0x7EC8 + [char]0x7AEF
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop ($orbitLabel + '.lnk')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $orbitExe
$shortcut.WorkingDirectory = $orbitRoot
$shortcut.IconLocation = "$orbitExe,0"
$shortcut.Description = 'Open ORBIT Creator Terminal'
$shortcut.Save()
Write-Output "Desktop shortcut: $shortcutPath"
Write-Output "Launcher: $orbitExe"
