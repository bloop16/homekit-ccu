🇬🇧 English | [🇩🇪 Deutsch](de/video-doorbell.md)

# Video doorbell and ffmpeg

The video doorbell (special accessory) needs an `ffmpeg` binary. OpenCCU does not ship one.

- **Remote mode** (recommended for cameras): run homekit-ccu on a machine that has ffmpeg with `libx264`, `libopus` and ideally `libfdk_aac`.
- **On the CCU**: copy a static build (for example the johnvansickle.com builds for arm64/amd64) to `/usr/local/bin/ffmpeg`, make it executable and set *Path to ffmpeg* in the doorbell settings (under *Show advanced settings*). The program has to be named `ffmpeg`; other programs are not started. Audio is offered only for encoders the binary actually has; without `libopus`/`libfdk_aac` the doorbell is published video-only.
- *Video codec* `copy` avoids transcoding when the camera already delivers H.264. This is the only realistic option on a Raspberry Pi based CCU.
- *URL RTSP video* accepts a plain RTSP/HTTP URL (homekit-ccu prepends `-re -i`) or, when it starts with `-`, raw ffmpeg input arguments. Raw arguments are passed as they are, so add `-re` yourself for sources that do not deliver at live rate (files, `lavfi` test sources); otherwise ffmpeg reads them as fast as it can. `-re -f lavfi -i testsrc=size=1280x720:rate=15 -re -f lavfi -i sine=frequency=440` gives a test pattern with a tone and needs no camera at all.
- *Talkback target* is an ffmpeg output; when set, Apple Home shows the talk button. A plain URL (for example `rtsp://camera/talk`) is sent as `-f rtsp <url>` with AAC audio. A value starting with `-` is taken as raw ffmpeg output options that follow the AAC default and override it, for example `-codec:a pcm_mulaw -ar 8000 -f rtsp rtsp://camera/talk` for a G.711 intercom, or `-f null -` to test the return channel without a device.
- Raw arguments in both fields are split on spaces; quoting is not supported, so values with spaces (for example in a file path or a password) cannot be passed.
- Credentials in URLs (`rtsp://user:pass@…`, `?user=…&password=…`) and SRTP keys are masked in the log.
- **Watchdog and firewalls:** the viewer (iPhone, iPad, Apple TV) sends RTCP to a random UDP port on the machine running homekit-ccu. A stream is ended when nothing arrives there: 30 s for the first packet (slow battery doorbells need time for the first frame), then after about 10 s of silence (five RTCP intervals, 10 to 60 s). A firewall between the viewer and homekit-ccu that blocks incoming UDP therefore breaks streaming: the picture appears and stops after about 30 s. The CCU firewall must allow incoming UDP on these return ports; if you cannot allow that, run homekit-ccu in remote mode on a machine without that restriction.
- ffmpeg errors (with the last lines of ffmpeg's output) are written to the log; snapshots are cached for 5 s.
