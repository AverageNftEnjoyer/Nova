Dim WshShell, nodeExe, cmdLine
Set WshShell = CreateObject("WScript.Shell")

' Resolve node.exe path (supports nvm and non-standard installs)
On Error Resume Next
nodeExe = WshShell.Exec("cmd /c where node").StdOut.ReadLine()
On Error GoTo 0

If nodeExe = "" Then nodeExe = "node"

' Launch Nova in a visible Command Prompt window.
cmdLine = "cmd.exe /k ""cd /d C:\Nova && """ & nodeExe & """ nova.js"""
WshShell.Run cmdLine, 1, False
