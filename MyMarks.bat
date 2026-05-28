@echo off
title MyMarks Portable
echo ============================================
echo   MyMarks - Gestor de Marcadores Portable
echo ============================================
echo.

:: Check if Python is available
where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Python encontrado. Iniciando servidor...
    echo.
    echo Abriendo MyMarks en http://localhost:8899
    echo Cierra esta ventana para detener el servidor.
    echo.
    start "" "http://localhost:8899/MyMarks_Portable.html"
    python -m http.server 8899 --bind 127.0.0.1
    goto :end
)

:: Check if Python3 is available
where python3 >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Python3 encontrado. Iniciando servidor...
    echo.
    echo Abriendo MyMarks en http://localhost:8899
    echo Cierra esta ventana para detener el servidor.
    echo.
    start "" "http://localhost:8899/MyMarks_Portable.html"
    python3 -m http.server 8899 --bind 127.0.0.1
    goto :end
)

:: Check if PowerShell can run a simple HTTP server
echo [INFO] Python no encontrado. Usando PowerShell como servidor...
echo.
echo Abriendo MyMarks en http://localhost:8899
echo Cierra esta ventana para detener el servidor.
echo.
start "" "http://localhost:8899/MyMarks_Portable.html"
powershell -ExecutionPolicy Bypass -Command ^
  "$listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://localhost:8899/'); $listener.Start(); Write-Host 'Servidor activo en http://localhost:8899'; while ($listener.IsListening) { $ctx = $listener.GetContext(); $file = $ctx.Request.Url.LocalPath.TrimStart('/'); if ([string]::IsNullOrEmpty($file)) { $file = 'MyMarks_Portable.html' }; $path = Join-Path '%~dp0' $file; if (Test-Path $path) { $bytes = [System.IO.File]::ReadAllBytes($path); $ext = [System.IO.Path]::GetExtension($path); $ct = 'text/html'; if ($ext -eq '.js') { $ct = 'application/javascript' } elseif ($ext -eq '.css') { $ct = 'text/css' } elseif ($ext -eq '.json') { $ct = 'application/json' }; $ctx.Response.ContentType = $ct; $ctx.Response.ContentLength64 = $bytes.Length; $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) } else { $ctx.Response.StatusCode = 404; $msg = [System.Text.Encoding]::UTF8.GetBytes('Not Found'); $ctx.Response.OutputStream.Write($msg, 0, $msg.Length) }; $ctx.Response.Close() }"

:end
echo.
echo MyMarks detenido.
pause
