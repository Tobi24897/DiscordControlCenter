' Creates a "Discord Control Center" shortcut on your desktop that starts the
' tool. Double-click this once — then you can launch it from the desktop.
' (Optional; you can always double-click "Start Discord Control Center.vbs" in
' this folder instead.)

Option Explicit

Dim fso, shell, root, desktop, lnk
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
desktop = shell.SpecialFolders("Desktop")

Set lnk = shell.CreateShortcut(desktop & "\Discord Control Center.lnk")
lnk.TargetPath = root & "\Start Discord Control Center.vbs"
lnk.WorkingDirectory = root
lnk.Description = "Start Discord Control Center"
If fso.FileExists(root & "\dcc_icon.ico") Then
    lnk.IconLocation = root & "\dcc_icon.ico"
End If
lnk.Save

MsgBox "Done! There is now a 'Discord Control Center' icon on your desktop." & vbCrLf & _
       "Double-click it to start the tool.", 64, "Discord Control Center"
