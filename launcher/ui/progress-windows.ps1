Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationFramework
$f = New-Object Windows.Forms.Form
$f.Text = 'Yinamp'
$f.ClientSize = New-Object Drawing.Size(400,180)
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
[void](Panel 0 0 400 1 $edge); [void](Panel 0 179 400 1 $dim)
[void](Panel 0 0 1 180 $edge); [void](Panel 399 0 1 180 $dim)
[void](Label 18 12 70 'YINAMP' 9 $accent)
[void](Panel 85 19 297 1 $edge); [void](Panel 85 22 297 1 $dim)
$title = Label 24 42 352 'SETTING UP YINAMP' 10 $accent
$action = Label 24 65 305 'Downloading player components' 9 $edge
$value = Label 330 65 46 '0%' 9 $accent
$value.TextAlign = 'TopRight'
[void](Panel 23 90 354 20 ([Drawing.ColorTranslator]::FromHtml('#191a23')))
$segments = @()
for ($i=0; $i -lt 32; $i++) { $segments += (Panel ([Math]::Round(26+$i*339/31)) 95 9 10 $dim) }
$markers = @(); $labels = @()
$names = @('GET','CHECK','UNPACK','PREPARE','OPEN')
for ($i=0; $i -lt 5; $i++) {
  $markers += (Panel (24+$i*73) 125 5 5 $dim)
  $labels += (Label (33+$i*73) 122 63 $names[$i] 7 $dim)
}
[void](Label 24 149 285 'A little setup. Then your music.' 8 $edge)
$cancel = New-Object Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.SetBounds(319,147,60,23)
$cancel.ForeColor = $accent
$cancel.FlatStyle = 'Flat'
$cancel.Add_Click({
  [IO.File]::WriteAllText($env:YINAMP_PROGRESS_FILE+'.cancel','cancel')
  $cancel.Enabled = $false
})
$f.Controls.Add($cancel)
$f.CancelButton = $cancel
$watch = [Diagnostics.Stopwatch]::StartNew()
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 33
$timer.Add_Tick({
  try {
    $s = Get-Content -LiteralPath $env:YINAMP_PROGRESS_FILE -Raw | ConvertFrom-Json
    $step = [Math]::Max(1,[Math]::Min(6,$s.step))
    $actions = @('Downloading player components','Verifying download','Unpacking player components','Preparing your player','Opening Yinamp','Cleaning up temporary files')
    $action.Text = $actions[$step-1]
    if ($step -eq 6) { $title.Text = 'CLEANING UP' } elseif ($step -eq 5) { $title.Text = 'BACK TO THE DESKTOP.' } else { $title.Text = 'SETTING UP YINAMP' }
    $measured = $step -eq 1 -or $step -eq 3 -or $step -eq 6
    $percent = [Math]::Max(0,[Math]::Min(100,$s.percent))
    if ($measured) { $value.Text = "{0:0}%" -f $percent } else { $value.Text = '' }
    $filled = [Math]::Floor($percent*32/100)
    $motion = [System.Windows.SystemParameters]::ClientAreaAnimation
    $sweep = [Math]::Floor($watch.Elapsed.TotalSeconds*14)%38-3
    for ($i=0; $i -lt 32; $i++) {
      if ($measured) { $lit = $i -lt $filled }
      elseif ($motion) { $lit = [Math]::Abs($i-$sweep) -lt 3 }
      else { $lit = $i%4 -eq 0 }
      if ($lit) { $segments[$i].BackColor=$accent } else { $segments[$i].BackColor=$dim }
    }
    for ($i=0; $i -lt 5; $i++) {
      if ($i+1 -le $step) { $color=$accent } else { $color=$dim }
      $markers[$i].BackColor=$color; $labels[$i].ForeColor=$color
    }
  } catch { }
})
$timer.Start()
[void]$f.ShowDialog()
$timer.Stop()
$timer.Dispose()
$f.Dispose()
