' Discord Control Center — Start (Doppelklick auf diese Datei).
'
' Bei jedem Klick:
'   1. Backend frisch starten: start_hidden.bat beendet eine evtl. laufende
'      (auch haengengebliebene) Instanz, gibt Port 8020 frei und startet EINE
'      saubere Instanz mit dem mitgelieferten Python (keine Installation noetig).
'   2. Das Dashboard im Browser oeffnen (Chrome bevorzugt, sonst Standardbrowser).
'
' Fenster schliessen = Programm beenden: solange der Tab offen ist, haelt er die
' Verbindung; ist kein Tab mehr verbunden, faehrt sich das Backend selbst herunter.

Option Explicit

Dim fso, shell, root
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)

If Not fso.FolderExists(root & "\data") Then
    fso.CreateFolder root & "\data"
End If

' 1. Backend frisch hochfahren (hidden, und WARTEN bis Port 8020 gebunden ist).
shell.Run """" & root & "\start_hidden.bat""", 0, True

' 2. Genau einen Tab oeffnen. Chrome bevorzugen, sonst Standardbrowser.
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
