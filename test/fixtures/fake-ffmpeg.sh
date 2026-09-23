#!/bin/sh
# Fake ffmpeg for tests. Behaviour is chosen by the argument list:
#   -encoders          -> prints an encoder list (FAKE_ENCODERS env overrides)
#   -f image2 -        -> writes a fake JPEG header to stdout and exits 0
#   -f sdp ... pipe:   -> reads stdin until EOF, then sleeps until killed
#   anything else      -> sleeps until killed (FAKE_EXIT_CODE env makes it exit immediately)
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
if [ -n "$FAKE_EXIT_CODE" ]; then
  echo "fake ffmpeg failing" >&2
  exit "$FAKE_EXIT_CODE"
fi
case " $* " in
  *" -f sdp "*) cat >/dev/null ;;
esac
while :; do sleep 1; done
