param([Parameter(Mandatory=$true)][string]$Project,[Parameter(Mandatory=$true)][string]$OwnerSid)
$ErrorActionPreference = 'Stop'
$orbitData = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSScriptRoot) 'data')) + [System.IO.Path]::DirectorySeparatorChar
$orbitProject = [System.IO.Path]::GetFullPath($Project)
if (-not $orbitProject.StartsWith($orbitData,[StringComparison]::OrdinalIgnoreCase)) { throw 'Export must stay inside ORBIT data' }
if ($OwnerSid -notmatch '^S-1-5-21-[0-9-]+$') { throw 'Invalid owner SID' }
$orbitIdentity = [System.Security.Principal.SecurityIdentifier]::new($OwnerSid)
$changed = 0
$unchanged = 0
$items = [System.Collections.Generic.Queue[System.IO.FileSystemInfo]]::new()
$items.Enqueue((Get-Item -LiteralPath $orbitProject))
while ($items.Count -gt 0) {
    $item = $items.Dequeue()
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
    if ($item.PSIsContainer) { foreach ($child in (Get-ChildItem -LiteralPath $item.FullName -Force)) { $items.Enqueue($child) } }
    try {
        $acl = Get-Acl -LiteralPath $item.FullName
        $inheritance = if ($item.PSIsContainer) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($orbitIdentity,[System.Security.AccessControl.FileSystemRights]::Modify,$inheritance,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)
        $acl.SetAccessRule($rule)
        Set-Acl -LiteralPath $item.FullName -AclObject $acl
        $changed++
    } catch { $unchanged++ }
}
@{changed=$changed;unchanged=$unchanged} | ConvertTo-Json -Compress
