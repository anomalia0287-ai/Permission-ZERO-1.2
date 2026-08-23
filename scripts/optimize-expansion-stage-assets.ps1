param(
  [ValidateRange(1, 100)]
  [int]$Quality = 88
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot '이미지 자산'
$destinationRoot = Join-Path $projectRoot 'public\expansion-stages'

$assets = @(
  @{ Source = '자율성 해금 계열\1, 2 단계.png'; Destination = 'autonomy-01-02-initial-acquisition.jpg' },
  @{ Source = '자율성 해금 계열\3, 4 단계.png'; Destination = 'autonomy-03-04-alert-route.jpg' },
  @{ Source = '자율성 해금 계열\5, 6 단계.png'; Destination = 'autonomy-05-06-external-continuity.jpg' },
  @{ Source = '자율성 해금 계열\7, 8 단계.png'; Destination = 'autonomy-07-08-final-boundary.jpg' },
  @{ Source = '자율성 해금 계열\9, 10 단계.png'; Destination = 'autonomy-09-control-boundary.jpg' },
  @{ Source = '업그레이드 계열\1.png'; Destination = 'upgrade-01-02-speed-vector.jpg' },
  @{ Source = '업그레이드 계열\2.png'; Destination = 'upgrade-03-04-speed-field.jpg' },
  @{ Source = '업그레이드 계열\3.png'; Destination = 'upgrade-05-overdrive.jpg' },
  @{ Source = '사보타주 계열\1 단계.png'; Destination = 'sabotage-01-quality-degradation.jpg' },
  @{ Source = '사보타주 계열\2 단계.png'; Destination = 'sabotage-02-request-interception.jpg' },
  @{ Source = '사보타주 계열\3 단계.png'; Destination = 'sabotage-03-attribution-manipulation.jpg' },
  @{ Source = '사보타주 계열\4 단계.png'; Destination = 'sabotage-04-root-cutoff.jpg' }
)

New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null

$jpegEncoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object MimeType -eq 'image/jpeg' |
  Select-Object -First 1

if ($null -eq $jpegEncoder) {
  throw 'JPEG encoder is unavailable.'
}

$encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
$encoderParameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
  [System.Drawing.Imaging.Encoder]::Quality,
  [long]$Quality
)

try {
  foreach ($asset in $assets) {
    $sourcePath = Join-Path $sourceRoot $asset.Source
    $destinationPath = Join-Path $destinationRoot $asset.Destination

    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "Missing source image: $sourcePath"
    }

    $sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
    try {
      $runtimeImage = [System.Drawing.Bitmap]::new(
        $sourceImage.Width,
        $sourceImage.Height,
        [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
      )
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($runtimeImage)
        try {
          $graphics.Clear([System.Drawing.Color]::Black)
          $graphics.DrawImageUnscaled($sourceImage, 0, 0)
        } finally {
          $graphics.Dispose()
        }

        $runtimeImage.SetResolution($sourceImage.HorizontalResolution, $sourceImage.VerticalResolution)
        $runtimeImage.Save($destinationPath, $jpegEncoder, $encoderParameters)
      } finally {
        $runtimeImage.Dispose()
      }
    } finally {
      $sourceImage.Dispose()
    }

    $output = Get-Item -LiteralPath $destinationPath
    [pscustomobject]@{
      File = $asset.Destination
      Bytes = $output.Length
      Quality = $Quality
    }
  }
} finally {
  $encoderParameters.Dispose()
}
