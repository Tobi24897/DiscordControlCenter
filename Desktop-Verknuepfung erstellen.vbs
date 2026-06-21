' Legt eine Verknuepfung "Discord Control Center" auf dem Desktop an, die das
' Tool startet. Einmal doppelklicken — danach startest du das Tool bequem vom
' Desktop. (Optional; du kannst auch immer direkt "Discord Control Center
' starten.vbs" in diesem Ordner doppelklicken.)

Option Explicit

Dim fso, shell, root, desktop, lnk
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
desktop = shell.SpecialFolders("Desktop")

Set lnk = shell.CreateShortcut(desktop & "\Discord Control Center.lnk")
lnk.TargetPath = root & "\Discord Control Center starten.vbs"
lnk.WorkingDirectory = root
lnk.Description = "Discord Control Center starten"
If fso.FileExists(root & "\dcc_icon.ico") Then
    lnk.IconLocation = root & "\dcc_icon.ico"
End If
lnk.Save

MsgBox "Fertig! Auf dem Desktop liegt jetzt 'Discord Control Center'." & vbCrLf & _
       "Doppelklick darauf startet das Tool.", 64, "Discord Control Center"
