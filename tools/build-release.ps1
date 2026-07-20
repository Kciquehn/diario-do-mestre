Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$toolsDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $toolsDirectory))
$distDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "dist"))
$stageDirectory = Join-Path $distDirectory "package"
$archivePath = Join-Path $distDirectory "diario-do-mestre.zip"
$releaseManifestPath = Join-Path $distDirectory "module.json"

if ((Split-Path -Parent $distDirectory) -ne $projectRoot -or (Split-Path -Leaf $distDirectory) -ne "dist") {
  throw "O diretório de saída não passou pela verificação de segurança."
}

& node (Join-Path $toolsDirectory "validate.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "A validação falhou; o pacote não será gerado."
}

if (Test-Path -LiteralPath $distDirectory) {
  Remove-Item -LiteralPath $distDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null

$requiredEntries = @(
  "module.json",
  "README.md",
  "CHANGELOG.md",
  "lang",
  "scripts",
  "styles",
  "templates"
)

foreach ($entry in $requiredEntries) {
  $source = Join-Path $projectRoot $entry
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Arquivo obrigatório ausente: $entry"
  }
  Copy-Item -LiteralPath $source -Destination $stageDirectory -Recurse -Force
}

$licensePath = Join-Path $projectRoot "LICENSE"
if (Test-Path -LiteralPath $licensePath) {
  Copy-Item -LiteralPath $licensePath -Destination $stageDirectory -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew)
$archiveWriter = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in Get-ChildItem -LiteralPath $stageDirectory -Recurse -File) {
    $entryName = $file.FullName.Substring($stageDirectory.Length + 1).Replace("\", "/")
    $entry = $archiveWriter.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $inputStream = [System.IO.File]::OpenRead($file.FullName)
    $outputStream = $entry.Open()
    try {
      $inputStream.CopyTo($outputStream)
    } finally {
      $outputStream.Dispose()
      $inputStream.Dispose()
    }
  }
} finally {
  $archiveWriter.Dispose()
  $archiveStream.Dispose()
}
Copy-Item -LiteralPath (Join-Path $projectRoot "module.json") -Destination $releaseManifestPath -Force
Remove-Item -LiteralPath $stageDirectory -Recurse -Force

$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
  if ($entries -notcontains "module.json") {
    throw "O ZIP não possui module.json na raiz."
  }
  if ($entries | Where-Object { $_ -match "^(?:\.git|\.github|tools|dist|node_modules)/" }) {
    throw "O ZIP contém arquivos de desenvolvimento."
  }
} finally {
  $archive.Dispose()
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash
Write-Output "Pacote criado: $archivePath"
Write-Output "Manifesto da release: $releaseManifestPath"
Write-Output "SHA256: $hash"
