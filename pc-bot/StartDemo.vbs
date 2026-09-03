' Puts Demo on THIS PC, then starts it.
' Does not run from inside a zip. Installs to %USERPROFILE%\MT5-Demo

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

home = sh.ExpandEnvironmentStrings("%USERPROFILE%")
installDir = home & "\MT5-Demo"
srcDir = fso.GetParentFolderName(WScript.ScriptFullName)
pyUrl = "https://trading-production-2c95.up.railway.app/pc-files/mt5_demo.py"

If Not fso.FolderExists(installDir) Then fso.CreateFolder installDir

srcPy = srcDir & "\mt5_demo.py"
destPy = installDir & "\mt5_demo.py"

If fso.FileExists(srcPy) Then
  fso.CopyFile srcPy, destPy, True
End If

' Always refresh from the live site so trading fixes apply.
code = sh.Run("cmd /c curl.exe -L --fail -o """ & destPy & """ """ & pyUrl & """", 0, True)
If (code <> 0 Or Not fso.FileExists(destPy)) And fso.FileExists(srcPy) Then
  fso.CopyFile srcPy, destPy, True
End If

If Not fso.FileExists(destPy) Then
  MsgBox "Could not save mt5_demo.py to:" & vbCrLf & installDir & vbCrLf & vbCrLf & _
    "Do this instead:" & vbCrLf & _
    "1. Close this." & vbCrLf & _
    "2. In Downloads, RIGHT-CLICK the zip." & vbCrLf & _
    "3. Click Extract All, then Extract." & vbCrLf & _
    "4. Open the new folder (not the zip) and double-click DOUBLE-CLICK-ME.", 16, "MT5 Demo"
  WScript.Quit 1
End If

pythonCmd = ""
cmds = Array("py -3", "py", "python", "python3")
For Each c In cmds
  code = sh.Run("cmd /c " & c & " --version >nul 2>&1", 0, True)
  If code = 0 Then
    pythonCmd = c
    Exit For
  End If
Next

If pythonCmd = "" Then
  MsgBox "Python is not installed on this PC." & vbCrLf & vbCrLf & _
    "1. Open https://www.python.org/downloads/" & vbCrLf & _
    "2. Install Python. Tick Add python.exe to PATH." & vbCrLf & _
    "3. Double-click StartDemo again." & vbCrLf & vbCrLf & _
    "Open MetaTrader 5 on Demo first.", 64, "MT5 Demo"
  WScript.Quit 1
End If

cmdline = "cmd /k cd /d """ & installDir & """ && echo Demo is installed at " & installDir & " && " & _
  pythonCmd & " -m pip install MetaTrader5 && " & pythonCmd & " mt5_demo.py"
sh.Run cmdline, 1, False
