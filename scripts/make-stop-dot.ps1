# 生成站点圆点标记图标：48x48 靛蓝实心圆 + 白色描边
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(48, 48)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
$fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 99, 102, 241))
$pen  = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 5)
$g.FillEllipse($fill, 8, 8, 32, 32)
$g.DrawEllipse($pen, 8, 8, 32, 32)
$out = Join-Path $PSScriptRoot '..\src\static\stop-dot.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $fill.Dispose(); $pen.Dispose()
Write-Output "saved: $out"
