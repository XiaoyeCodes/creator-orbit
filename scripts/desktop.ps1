$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$result = [ordered]@{}
function Set-OrbitClipboard($text, $files) {
    $data = [System.Windows.Forms.DataObject]::new()
    $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, [string]$text)
    if ($files -and $files.Count -gt 0) {
        $list = [System.Collections.Specialized.StringCollection]::new()
        foreach ($file in $files) {
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Image file no longer exists' }
            $list.Add([string]$file) | Out-Null
        }
        $data.SetFileDropList($list)
    }
    [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 8, 100)
}
switch ($request.action) {
    'copy' { Set-OrbitClipboard $request.text $request.files; $result.clipboard = $true }
    'open-folder' {
        if (-not (Test-Path -LiteralPath $request.folder -PathType Container)) { throw 'Output folder is missing' }
        Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $request.folder + '"') | Out-Null
        $result.folder = $true
    }
    'prepare-publish' {
        try { Set-OrbitClipboard $request.text $request.files; $result.clipboard = $true } catch { $result.clipboard = $false; $result.clipboardError = $_.Exception.Message }
        try { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $request.folder + '"') | Out-Null; $result.folder = $true } catch { $result.folder = $false; $result.folderError = $_.Exception.Message }
        try { Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $request.captionFile + '"') | Out-Null; $result.caption = $true } catch { $result.caption = $false; $result.captionError = $_.Exception.Message }
        try { Start-Process -FilePath ([string]$request.files[0]) | Out-Null; $result.preview = $true } catch { $result.preview = $false; $result.previewError = $_.Exception.Message }
        try { Start-Process 'https://creator.xiaohongshu.com/publish/publish?source=official&target=image' | Out-Null; $result.browser = $true } catch { $result.browser = $false; $result.browserError = $_.Exception.Message }
    }
    default { throw 'Unknown desktop action' }
}
$result | ConvertTo-Json -Compress
