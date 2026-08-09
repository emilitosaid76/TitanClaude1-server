Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\TitanAgent"
shell.Run "cmd /c node server.js > C:\TitanAgent\server.log 2>&1", 0, False
