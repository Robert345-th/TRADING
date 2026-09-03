' Double-click this. Windows Script Host starts Demo trading.
' Same as StartDemo.js — no Node or Python.

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
js = folder & "\StartDemo.js"
sh.Run "cscript.exe //nologo """ & js & """", 1, False
