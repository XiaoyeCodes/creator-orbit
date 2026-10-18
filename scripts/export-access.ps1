param([Parameter(Mandatory=$true)][string]$Project,[Parameter(Mandatory=$true)][string]$OwnerSid)
$ErrorActionPreference = 'Stop'
$orbitData = [System.IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSScriptRoot) 'data')) + [System.IO.Path]::DirectorySeparatorChar
$orbitProject = [System.IO.Path]::GetFullPath($Project)
if (-not $orbitProject.StartsWith($orbitData,[StringComparison]::OrdinalIgnoreCase)) { throw 'Export must stay inside ORBIT data' }
# Reject junctions in the whole path, including ancestors of the task directory.
$ancestor = Get-Item -LiteralPath $orbitProject
while ($ancestor -and $ancestor.FullName.Length -ge $orbitData.TrimEnd('\').Length) {
    if ($ancestor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Export path cannot contain a reparse point' }
    $ancestor = $ancestor.Parent
}
if ($OwnerSid -notmatch '^S-1-5-21-[0-9-]+$') { throw 'Invalid owner SID' }
$orbitIdentity = [System.Security.Principal.SecurityIdentifier]::new($OwnerSid)
$changed = 0
$unchanged = 0
$failed = [System.Collections.Generic.List[object]]::new()
$items = [System.Collections.Generic.Queue[System.IO.FileSystemInfo]]::new()
$items.Enqueue((Get-Item -LiteralPath $orbitProject))
while ($items.Count -gt 0) {
    $item = $items.Dequeue()
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
    try {
        # Only edit the DACL. Loading/writing owner or audit sections may demand
        # SeSecurityPrivilege, which the isolated account intentionally lacks.
        $sections = [System.Security.AccessControl.AccessControlSections]::Access
        $acl = if ($item.PSIsContainer) { [System.IO.Directory]::GetAccessControl($item.FullName,$sections) } else { [System.IO.File]::GetAccessControl($item.FullName,$sections) }
        $inheritance = if ($item.PSIsContainer) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($orbitIdentity,[System.Security.AccessControl.FileSystemRights]::Modify,$inheritance,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)
        $existing = $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | Where-Object {
            $_.IdentityReference.Value -eq $OwnerSid -and $_.AccessControlType -eq 'Allow' -and
            ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Modify) -eq [System.Security.AccessControl.FileSystemRights]::Modify -and
            ($_.InheritanceFlags -band $inheritance) -eq $inheritance
        }
        if ($existing) { $unchanged++ } else {
            $acl.SetAccessRule($rule)
            if ($item.PSIsContainer) { [System.IO.Directory]::SetAccessControl($item.FullName,$acl) } else { [System.IO.File]::SetAccessControl($item.FullName,$acl) }
            $changed++
        }
    } catch { $failed.Add(@{path=$item.FullName;error=$_.Exception.Message}) }
    if ($item.PSIsContainer) {
        try { foreach ($child in (Get-ChildItem -LiteralPath $item.FullName -Force)) { $items.Enqueue($child) } }
        catch { $failed.Add(@{path=$item.FullName;error=$_.Exception.Message}) }
    }
}
# Some host-owned files cannot be re-ACLed by the sandbox. The host separately
# checks readability, so these failures must be reported rather than hidden.
@{changed=$changed;unchanged=$unchanged;failed=@($failed.ToArray())} | ConvertTo-Json -Compress -Depth 4
