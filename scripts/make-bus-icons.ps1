# Generate vehicle marker icons for native <map>:
#   bus-live-{dir}.png : direction color solid circle + white stroke
# Colors match DIR_STYLE in map.vue: 0 = up (#22D3EE), 1 = down (#FB7185)
Add-Type -AssemblyName System.Drawing

$dirs = @{
    '0' = [System.Drawing.Color]::FromArgb(255, 34, 211, 238)   # #22D3EE up
    '1' = [System.Drawing.Color]::FromArgb(255, 251, 113, 133)  # #FB7185 down
}
$white = [System.Drawing.Color]::White
$static = Join-Path $PSScriptRoot '..\src\static'

foreach ($d in ($dirs.Keys | Sort-Object)) {
    $color = $dirs[$d]
    $bmp = [System.Drawing.Bitmap]::new(34, 34)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # white outer ring
    $pen = [System.Drawing.Pen]::new($white, 4)
    $g.DrawEllipse($pen, 4, 4, 26, 26)

    # direction color fill
    $brush = [System.Drawing.SolidBrush]::new($color)
    $g.FillEllipse($brush, 8, 8, 18, 18)

    $out = Join-Path $static ("bus-live-" + $d + ".png")
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $pen.Dispose(); $brush.Dispose()
    Write-Output ("saved: bus-live-" + $d + ".png")
}

# verify
foreach ($n in @('bus-live-0', 'bus-live-1')) {
    $p = Join-Path $static ($n + ".png")
    if (-not (Test-Path $p)) { Write-Output ("MISSING: " + $n + ".png"); continue }
    $img = [System.Drawing.Image]::FromFile($p)
    Write-Output ("ok: {0}.png {1}x{2} {3}B" -f $n, $img.Width, $img.Height, (Get-Item $p).Length)
    $img.Dispose()
}