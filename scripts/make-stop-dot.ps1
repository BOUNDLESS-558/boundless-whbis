# Generate station marker icons for native <map>:
#   stop-dot-{dir}.png   : white heart + direction color ring
#   stop-end-{dir}.png   : direction color solid circle + white stroke
# Colors match DIR_STYLE in map.vue: 0 = up (#22D3EE), 1 = down (#FB7185)
Add-Type -AssemblyName System.Drawing

$dirs = @{
    '0' = [System.Drawing.Color]::FromArgb(255, 34, 211, 238)
    '1' = [System.Drawing.Color]::FromArgb(255, 251, 113, 133)
}
$white = [System.Drawing.Color]::White
$static = Join-Path $PSScriptRoot '..\src\static'

function New-Canvas {
    $bmp = [System.Drawing.Bitmap]::new(48, 48)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    return @{ bmp = $bmp; g = $g }
}

foreach ($d in ($dirs.Keys | Sort-Object)) {
    $color = $dirs[$d]

    # middle station: white heart ring
    $c = New-Canvas
    $ring = [System.Drawing.SolidBrush]::new($color)
    $inner = [System.Drawing.SolidBrush]::new($white)
    $c.g.FillEllipse($ring, 6, 6, 36, 36)
    $c.g.FillEllipse($inner, 15, 15, 18, 18)
    $out = Join-Path $static ("stop-dot-" + $d + ".png")
    $c.bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $c.g.Dispose(); $c.bmp.Dispose(); $ring.Dispose(); $inner.Dispose()
    Write-Output ("saved: stop-dot-" + $d + ".png")

    # terminal station: solid circle + white stroke
    $c2 = New-Canvas
    $fill = [System.Drawing.SolidBrush]::new($color)
    $pen = [System.Drawing.Pen]::new($white, 5)
    $c2.g.FillEllipse($fill, 8, 8, 32, 32)
    $c2.g.DrawEllipse($pen, 8, 8, 32, 32)
    $out2 = Join-Path $static ("stop-end-" + $d + ".png")
    $c2.bmp.Save($out2, [System.Drawing.Imaging.ImageFormat]::Png)
    $c2.g.Dispose(); $c2.bmp.Dispose(); $fill.Dispose(); $pen.Dispose()
    Write-Output ("saved: stop-end-" + $d + ".png")
}

# verify all four images exist with correct size
foreach ($n in @('stop-dot-0', 'stop-dot-1', 'stop-end-0', 'stop-end-1')) {
    $p = Join-Path $static ($n + ".png")
    if (-not (Test-Path $p)) { Write-Output ("MISSING: " + $n + ".png"); continue }
    $img = [System.Drawing.Image]::FromFile($p)
    Write-Output ("ok: {0}.png {1}x{2} {3}B" -f $n, $img.Width, $img.Height, (Get-Item $p).Length)
    $img.Dispose()
}
