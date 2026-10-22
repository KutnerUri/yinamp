Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$f = New-Object Windows.Forms.Form
$f.Text = 'Yinamp'
$f.ClientSize = New-Object Drawing.Size(360,112)
$f.FormBorderStyle = 'None'
$f.StartPosition = 'CenterScreen'
$f.ShowInTaskbar = $false
$f.TopMost = $true
$f.BackColor = [Drawing.ColorTranslator]::FromHtml('#30313f')
$f.AutoScaleMode = 'None'
$accent = [Drawing.ColorTranslator]::FromHtml('#dddde7')
$dim = [Drawing.ColorTranslator]::FromHtml('#434452')
$edge = [Drawing.ColorTranslator]::FromHtml('#7c7e91')
function Panel($x,$y,$w,$h,$color) {
  $p = New-Object Windows.Forms.Panel
  $p.SetBounds($x,$y,$w,$h)
  $p.BackColor = $color
  $f.Controls.Add($p)
  $p.BringToFront()
  return $p
}
function Label($x,$y,$w,$text,$size,$color) {
  $l = New-Object Windows.Forms.Label
  $l.SetBounds($x,$y,$w,18)
  $l.Text = $text
  $l.Font = New-Object Drawing.Font('Consolas',$size)
  $l.ForeColor = $color
  $l.BackColor = [Drawing.Color]::Transparent
  $f.Controls.Add($l)
  $l.BringToFront()
  return $l
}
[void](Panel 0 0 360 1 $edge); [void](Panel 0 111 360 1 $edge)
[void](Panel 0 0 1 112 $edge); [void](Panel 359 0 1 112 $edge)
[void](Label 16 12 70 'YINAMP' 9 ([Drawing.ColorTranslator]::FromHtml('#dddde7')))
[void](Panel 81 19 263 1 $edge)
$action = Label 26 46 265 'Downloading Electron...' 10 $accent
$step = Label 295 46 39 '1/4' 10 ([Drawing.ColorTranslator]::FromHtml('#dddde7'))
$action.BackColor = [Drawing.ColorTranslator]::FromHtml('#30313f')
$step.BackColor = $action.BackColor
$step.TextAlign = 'TopRight'
$segments = @()
for ($i=0; $i -lt 28; $i++) { $segments += (Panel (27+$i*11) 75 9 8 $dim) }
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
  try {
    $s = Get-Content -LiteralPath $env:YINAMP_PROGRESS_FILE -Raw | ConvertFrom-Json
    $action.Text = $s.action
    $step.Text = "$($s.step)/4"
    $filled = [Math]::Floor([Math]::Max(0,[Math]::Min(100,$s.percent))*28/100)
    for ($i=0; $i -lt 28; $i++) { if ($i -lt $filled) { $segments[$i].BackColor=$accent } else { $segments[$i].BackColor=$dim } }
  } catch { }
})
$timer.Start()
[void]$f.ShowDialog()
$timer.Stop()
$timer.Dispose()
$f.Dispose()
