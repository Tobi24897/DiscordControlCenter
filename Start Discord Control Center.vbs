' Discord Control Center — Start (double-click this file).
'
' On every click:
'   1. Fresh-start the backend: start_hidden.bat stops any running (or stuck)
'      instance, frees port 8020, and starts ONE clean instance using the
'      bundled Python (no installation needed).
'   2. Open the dashboard in your browser (Chrome preferred, else the default).
'
' Close window = quit: while the tab is open it holds the connection; once no
' tab is connected, the backend shuts itself down.

Option Explicit

Dim fso, shell, root
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)

If Not fso.FolderExists(root & "\data") Then
    fso.CreateFolder root & "\data"
End If

' 1. Boot the backend (hidden, and WAIT until port 8020 is bound).
shell.Run """" & root & "\start_hidden.bat""", 0, True

' 2. Open exactly one tab. Prefer Chrome, else the default browser.
Dim chromeExe
chromeExe = findChromeExe()
If chromeExe <> "" Then
    shell.Run """" & chromeExe & """ http://localhost:8020", 1, False
Else
    shell.Run "cmd /c start """" http://localhost:8020", 0, False
End If

Function findChromeExe()
    findChromeExe = ""
    Dim candidates, i
    candidates = Array( _
        shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
        shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
        shell.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe" )
    For i = 0 To UBound(candidates)
        If fso.FileExists(candidates(i)) Then
            findChromeExe = candidates(i)
            Exit Function
        End If
    Next
End Function
