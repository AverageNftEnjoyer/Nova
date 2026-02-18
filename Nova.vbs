Dim WshShell, nodeExe, exitCode
Set WshShell = CreateObject("WScript.Shell")

' Resolve node.exe path — handles nvm and non-standard installs
On Error Resume Next
nodeExe = WshShell.Exec("cmd /c where node").StdOut.ReadLine()
On Error GoTo 0

If nodeExe = "" Then nodeExe = "node"

WshShell.CurrentDirectory = "C:\Nova"
exitCode = WshShell.Run("""" & nodeExe & """ nova.js", 0, False)
