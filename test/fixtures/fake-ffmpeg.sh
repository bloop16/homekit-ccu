#!/bin/sh
# Fake ffmpeg for tests. Behaviour is chosen by environment and argument list:
#   FAKE_EXIT_CODE     -> prints two stderr lines (one with URL credentials) and exits with that code
#   -encoders          -> prints an encoder list (FAKE_ENCODERS env overrides)
#   -f image2 -        -> writes a fake JPEG header to stdout and exits 0
#   -f sdp ... pipe:   -> reads stdin until EOF, then runs until stopped
#   anything else      -> runs until stopped
# Long running modes exit 0 on SIGTERM like ffmpeg, unless FAKE_IGNORE_TERM is set.
if [ -n "$FAKE_EXIT_CODE" ]; then
  echo "fake ffmpeg failing" >&2
  echo "rtsp://admin:secret@cam/stream: Connection refused" >&2
  exit "$FAKE_EXIT_CODE"
fi
case " $* " in
  *" -encoders "*)
    echo "Encoders:"
    echo "${FAKE_ENCODERS:- A..... libopus            libopus Opus
 A..... libfdk_aac         Fraunhofer FDK AAC
 V..... libx264            libx264 H.264}"
    exit 0 ;;
  *" -f image2 - "*)
    printf '\377\330\377\340FAKEJPEG'
    exit 0 ;;
esac
SLEEP_PID=
if [ -n "$FAKE_IGNORE_TERM" ]; then
  trap '' TERM
else
  trap '[ -n "$SLEEP_PID" ] && kill $SLEEP_PID 2>/dev/null; exit 0' TERM
fi
case " $* " in
  *" -f sdp "*) cat >/dev/null ;;
esac
while :; do
  sleep 1 &
  SLEEP_PID=$!
  wait $SLEEP_PID
done
