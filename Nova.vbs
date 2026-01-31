Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Nova"
WshShell.Run "node nova.js", 0, False
