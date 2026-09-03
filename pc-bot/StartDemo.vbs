' Starts YOUR MetaTrader 5 DEMO account into the live Trade Tracker site.
' Double-click this on the Windows PC that has MT5 open.

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
script = folder & "\mt5_demo.py"

If Not fso.FileExists(script) Then
  MsgBox "mt5_demo.py is missing in:" & vbCrLf & folder, 16, "MT5 Demo"
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
  MsgBox "This uses the DEMO account already logged into MetaTrader 5 on THIS computer." & vbCrLf & vbCrLf & _
    "1. Open MetaTrader 5 and log into your DEMO account." & vbCrLf & _
    "2. Install Python from https://www.python.org/downloads/" & vbCrLf & _
    "   Tick: Add python.exe to PATH" & vbCrLf & _
    "3. Double-click StartDemo.vbs again." & vbCrLf & vbCrLf & _
    "The website cannot see your demo login until this is running.", 64, "MT5 Demo"
  WScript.Quit 1
End If

cmdline = "cmd /k cd /d """ & folder & """ && echo Using your MT5 DEMO account... && " & _
  pythonCmd & " -m pip install MetaTrader5 && " & pythonCmd & " mt5_demo.py"
sh.Run cmdline, 1, False
