!macro customInstall
  WriteRegStr SHCTX "Software\Classes\opencode-tokenmax" "" "URL:OpenCode TokenMax Dev"
  WriteRegStr SHCTX "Software\Classes\opencode-tokenmax" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\opencode-tokenmax\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\opencode-tokenmax\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\opencode-tokenmax"
!macroend
