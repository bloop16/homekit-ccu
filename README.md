<h1 style="display:inline"><img src="doc/HomeKit-CCU_LogoBlue.png" style="float:left;"> HomeKit-CCU</h1>

[![CI](https://github.com/bloop16/homekit-ccu/actions/workflows/ci.yml/badge.svg)](https://github.com/bloop16/homekit-ccu/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/bloop16/homekit-ccu?include_prereleases)](https://github.com/bloop16/homekit-ccu/releases/latest)

<p align="center">
    <img src="doc/hap_homematic_ui2.png">
</p>


a RaspberryMatic / OpenCCU / CCU3 addon

# Origin

This project is a fork of [hap-homematic](https://github.com/thkl/hap-homematic) by Thomas Kluge ([@thkl](https://github.com/thkl)), forked at version **0.0.14**. The original project provided the foundation for bridging HomeMatic devices into HomeKit. This fork was created to add OpenCCU compatibility, modernise the build process, and continue development under the new name homekit-ccu.

All credit for the original implementation goes to Thomas Kluge and the contributors of [hap-homematic](https://github.com/thkl/hap-homematic).

# Description

This RaspberryMatic / OpenCCU / CCU3 addon will allow you to access your HomeMatic devices from HomeKit. It is much like https://github.com/thkl/homebridge-homematic but without homebridge.
All this runs on your RaspberryMatic / OpenCCU / CCU3. You will not need any extra hardware.

Requires OpenCCU 3.89 or newer, which ships Node.js 22. The addon does not bundle Node.js; if the CCU's Node.js is older than 22 the installation stops with an error in `/var/log/homekit-ccu.log`.

# What's new in 0.1.0

- HAP stack upgraded from hap-nodejs 0.11 (2023) to @homebridge/hap-nodejs 2.2 (2026): security fixes and current iOS/tvOS 26/27 compatibility
- Video doorbell rewritten on the HAP CameraController: audio (Opus / AAC-ELD) and optional two-way audio
- mDNS advertiser selectable in `config.json` (`"advertiser": "bonjour-hap" | "ciao" | "avahi"`)
- Dependencies refreshed (commander 14, formidable 3, fakegato-history 0.6, moment removed), `npm audit` clean except two low findings in binrpc (see CHANGELOG)
- GitHub Actions CI and release pipeline; the addon tarball is built on every `v*` tag
- Requires Node.js 22 (OpenCCU 3.89+)

See [CHANGELOG.md](CHANGELOG.md) for the details and for older versions.

# Upgrading from hap-homematic / homekit-ccu 0.0.x

- **Bridges keep their pairings.** The HomeKit storage format is unchanged; bridges and their accessories stay in Apple Home, including rooms and automations.
- **The video doorbell has to be added again.** It now gets its own HomeKit identity (derived from its UUID instead of the fixed `00:00:11:22:22:11`), and the old default PIN `123-45-678` is rejected as trivial. If the doorbell still uses that PIN, set a different one in the doorbell settings; otherwise the doorbell is not published and the log says why. Then remove the old doorbell in Apple Home and add it again with the new PIN. Renaming the doorbell also changes its identity.
- **Restoring a configuration backup** in the configuration UI requires a valid CCU session when authentication is turned on, like every other change. Open the configuration page from the CCU's system control, not from a bookmark.
- **Restart** in the configuration UI now calls `/etc/config/rc.d/homekit-ccu restart` directly (the old npm script is gone). In remote mode there is no rc.d script; restart the process yourself.

# Installation
Download the latest addon (`homekit-ccu-x.y.z.tar.gz`) from https://github.com/bloop16/homekit-ccu/releases/latest and install it via *Settings → Control panel → Additional software* on your CCU.

The addon contains the complete npm package, so the CCU needs no internet access during installation. Installation runs in the background; after a minute or two you will have a HomeKit button in the CCU's control panel. Progress and errors are logged to `/var/log/homekit-ccu.log`.

The *Additional software* page shows the newest release as available version (the CCU asks GitHub for it).

This will not run on an older CCU2 model or on CCU firmware that ships a Node.js older than 22.

# Running Modes

homekit-ccu can run in two modes: **local** (as a CCU addon) or **remote** (on a separate machine connecting to the CCU over the network).

## Local Mode (CCU Addon)

This is the default and recommended mode. homekit-ccu runs directly on the CCU as an addon and communicates with all services via localhost using internal ports.

```bash
node index.js -D
```

## Remote Mode

You can run homekit-ccu on a separate machine (e.g. a Raspberry Pi, NAS, or desktop) and point it at your CCU. Use the `-H` flag to specify the CCU host address. If your CCU has XML-RPC basic auth enabled (common on OpenCCU), provide credentials with `-U` and `-P`.

```bash
node index.js -D -H 192.168.1.100
node index.js -D -H 192.168.1.100 -U rpcuser -P rpcpassword
```

In remote mode, homekit-ccu automatically remaps internal daemon ports (32001, 32010, 39292) to the external lighttpd-proxied ports (2001, 2010, 9292).

| CLI Flag | Description |
|----------|-------------|
| `-D` | Enable debug logging |
| `-H <host>` | CCU host IP address (default: localhost) |
| `-U <user>` | Username for XML-RPC basic auth (remote mode) |
| `-P <password>` | Password for XML-RPC basic auth (remote mode) |
| `-C <path>` | Configuration path |
| `-L <path>` | Log file path |
| `-S <file>` | Simulate with a devices file |
| `-R` | Dry run — only use cached files |

# Used Ports

* 9874 -> Config WebUI (lighttpd proxies it to the config server on 127.0.0.1:39874; in remote mode the config server listens on 9874 itself)
* 49874 -> Config WebUI HTTPS (proxied through lighttpd)
* 9875 -> RPC event server
* 9876 -> RPC event server CuxD (optional)
* 9877..n HAP Instance 0 .. n
* 5353/udp -> mDNS (Bonjour), so HomeKit can find the bridges
* random UDP ports -> video doorbell streams (see below)

Ports 9874 and 49874 are automatically opened in the CCU firewall during addon installation.

# Video Doorbell and ffmpeg

The video doorbell (special accessory) needs an `ffmpeg` binary. OpenCCU does not ship one.

- **Remote mode** (recommended for cameras): run homekit-ccu on a machine that has ffmpeg with `libx264`, `libopus` and ideally `libfdk_aac`.
- **On the CCU**: copy a static build (for example the johnvansickle.com builds for arm64/amd64) to `/usr/local/bin/ffmpeg`, make it executable and set *Path to ffmpeg* in the doorbell settings. Audio is offered only for encoders the binary actually has; without `libopus`/`libfdk_aac` the doorbell is published video-only.
- *Video codec* `copy` avoids transcoding when the camera already delivers H.264. This is the only realistic option on a Raspberry Pi based CCU.
- *URL RTSP video* accepts a plain RTSP/HTTP URL (homekit-ccu prepends `-re -i`) or, when it starts with `-`, raw ffmpeg input arguments. Raw arguments are passed as they are, so add `-re` yourself for sources that do not deliver at live rate (files, `lavfi` test sources); otherwise ffmpeg reads them as fast as it can. `-re -f lavfi -i testsrc=size=1280x720:rate=15 -re -f lavfi -i sine=frequency=440` gives a test pattern with a tone and needs no camera at all.
- *Talkback target* is an ffmpeg output; when set, Apple Home shows the talk button. A plain URL (for example `rtsp://camera/talk`) is sent as `-f rtsp <url>` with AAC audio. A value starting with `-` is taken as raw ffmpeg output options that follow the AAC default and override it, for example `-codec:a pcm_mulaw -ar 8000 -f rtsp rtsp://camera/talk` for a G.711 intercom, or `-f null -` to test the return channel without a device.
- Raw arguments in both fields are split on spaces; quoting is not supported, so values with spaces (for example in a file path or a password) cannot be passed.
- Credentials in URLs (`rtsp://user:pass@…`, `?user=…&password=…`) and SRTP keys are masked in the log.
- **Watchdog and firewalls:** the viewer (iPhone, iPad, Apple TV) sends RTCP to a random UDP port on the machine running homekit-ccu. A stream is ended when nothing arrives there: 30 s for the first packet (slow battery doorbells need time for the first frame), then after about 10 s of silence (five RTCP intervals, 10 to 60 s). A firewall between the viewer and homekit-ccu that blocks incoming UDP therefore breaks streaming: the picture appears and stops after about 30 s. On the CCU, check the firewall configuration in the control panel.
- ffmpeg errors (with the last lines of ffmpeg's output) are written to the log; snapshots are cached for 5 s.

# mDNS advertiser

`config.json` accepts `"advertiser"` with `bonjour-hap` (default, works on OpenCCU), `ciao` or `avahi` (uses the CCU's avahi daemon via D-Bus). Change it only if HomeKit cannot discover the bridge. An unknown value falls back to `bonjour-hap` with a warning in the log.

# Architecture

homekit-ccu connects to these CCU endpoints:

| Port | Service | Endpoint | Purpose |
|------|---------|----------|---------|
| 8183 (local) / 8181 (remote) | Rega | POST `/tclrega.exe` | Device/variable/program enumeration via TCL scripts |
| 2001 | BidCos-RF | XML-RPC | Classic HomeMatic RF devices |
| 2010 | HmIP-RF | XML-RPC | HomeMatic IP devices |
| 9292 | VirtualDevices | XML-RPC | Virtual/grouped devices |
| 80/443 | JSON-RPC | POST `/api/homematic.cgi` | Authentication, session management |

Key source files:
- `lib/HomeMaticCCU.js` — CCU connection manager, interface discovery, port mapping
- `lib/HomeMaticRPC.js` — XML-RPC/BinRPC event handling (port 9875)
- `lib/HomeMaticRegaRequest.js` — HTTP POST to Rega at `:8183/tclrega.exe` (internal port on the CCU) or `:8181/tclrega.exe` (remote mode)
- `lib/configurationsrv/ConfigurationService.js` — config server: JSON-RPC session check, firewall ports, backup/restore
- `lib/services/camera/` — video doorbell streaming (CameraController delegate, ffmpeg handling)
- `lib/Server.js` — HAP bridge server, instance management (ports 9877+)
- `index.js` — Entry point

# OpenCCU Compatibility

OpenCCU (formerly RaspberryMatic v3.87+) introduced several changes that affect homekit-ccu:

1. **64-bit only** — Dropped support for Pi0/Pi1/Pi2/armv7
2. **Lighttpd proxying** — XML-RPC ports 2001/2010/9292 are now proxied through lighttpd; secured variants on 42001/42010/49292
3. **Rega remote scripting** — Blocked on ports 80/443, only works on 8181/48181
4. **Port architecture** — Internal daemons listen on 32001 (rfd), 32010 (crRFD), 39292 (HMServer). Lighttpd proxies external ports: `external = internal - 30000`. Rega `InterfaceUrl()` reports internal ports; homekit-ccu remaps them automatically.
5. **Authentication changes** — New lighttpd-based auth against ReGaHss, optional basic auth on XML-RPC
6. **WebUI translation patching** — Changes to `/webui/js/lang/<lang>/translate.lang.extension.js`

Stefan, of verdrahtet.info, has made a nice german tutorial [here](https://www.verdrahtet.info/2020/05/02/homekit-und-homematic-einfach-wie-nie/)

# HTTPS
If you are using the https version of your ccu WebUI page, the configuration page is automatically available on port 49874 via the lighttpd HTTPS proxy. homekit-ccu will use the same self signed tls certificate as your ccu.

# Authentication
You can use your ccu user management as an optional authentication for homekit-ccu. If you turn on this feature, you have to call the configuration page from your ccu webUI system preference page to use a valid session. Only ccu admins are allowed to use the homekit-ccu configuration page if authentication was turned on.

# Concept of rooms
HAP the homekit accessory protocol does not know a room concept. So when you add one or more devices to a bridge they will appear at the same room as the bridge in your homekit client application. Therefore homekit-ccu is able to fire up multiple bridges (hap instances). During the installation wizard you may add an instance for each of your rooms, add these instances to homekit and put them into rooms. From this time on adding a new device to an instance will place this device into the same room as your bridge.

# FakeGato History
All generated homekit devices will support fakegato history (if there is a history option in eve). 
Please note: History is only available if you are using the Eve app as a homekit controller.

# Development

```bash
npm install          # install dependencies (Node.js 22)
npm test             # run tests
npm run lint         # standard, enforced in CI
npm run coverage     # c8, at least 80 % for the camera code
node index.js -D     # run in debug mode (expects CCU on localhost)
node index.js -D -H <host>  # run against remote CCU
```

## Devcontainer

A devcontainer in `.devcontainer/` provides a full OpenCCU environment for development and debugging. It runs a single container based on the OpenCCU image with Node.js layered on top, using Podman.

```bash
# Install homekit-ccu as a proper CCU addon (symlinks workspace source)
.devcontainer/install-addon.sh

# Use the rc.d script like the real CCU:
/usr/local/etc/config/rc.d/homekit-ccu start
/usr/local/etc/config/rc.d/homekit-ccu stop
/usr/local/etc/config/rc.d/homekit-ccu restart
/usr/local/etc/config/rc.d/homekit-ccu info

# Run in foreground with debug output:
node index.js -D

# Restart lighttpd:
killall lighttpd; sleep 1; lighttpd -f /etc/lighttpd/lighttpd.conf
```

The OpenCCU WebUI is available at `http://localhost:8080` from the host. The addon button appears under System Control after running `install-addon.sh`.

# Issues and not supported devices
Please open an issue [here](https://github.com/bloop16/homekit-ccu/issues/new) for everything that went wrong, and attach the relevant part of `/var/log/homekit-ccu.log`.

# Documentation
The configuration UI is still the one of hap-homematic, so the [hap-homematic wiki](https://github.com/thkl/hap-homematic/wiki) by Thomas Kluge covers most of it. The sections above describe what changed since.

## Useful commands for debugging

```shell

# re-deploy lighttpd conf
cp /usr/local/addons/homekit-ccu/node_modules/homekit-ccu/etc/homekit_ccu.conf /usr/local/etc/config/lighttpd/homekit-ccu.conf
# /etc/config -> ../usr/local/etc/config

# validate lighttpd config (catches syntax errors before restart)
lighttpd -t -f /etc/lighttpd/lighttpd.conf

# kill and restart lighttpd proxy
killall lighttpd; sleep 1; lighttpd -f /etc/lighttpd/lighttpd.conf

# print current lighttpd config
lighttpd -p -f /etc/lighttpd/lighttpd.conf 2>&1

# handle homekit-ccu daemon 
/usr/local/etc/config/rc.d/homekit-ccu restart
/usr/local/etc/config/rc.d/homekit-ccu stop 
/usr/local/etc/config/rc.d/homekit-ccu start

# serve 
node /usr/local/addons/homekit-ccu/node_modules/homekit-ccu/index.js -D 

# kill and restart homekit-ccu server
pkill -f 'node.*index.js' 2>/dev/null; sleep 1; node /usr/local/addons/homekit-ccu/node_modules/homekit-ccu/index.js -D 

# check if server is running 
curl -v http://127.0.0.1:9874/ 2>&1 | head -20

# Check if ports are open
netstat -tlnp | grep 9874

# check if ReGaHSS Remote Script API is available
curl -X POST -d "dom.GetObject(\"HmIP-RF\");" http://127.0.0.1:8181/rega.exe
# With login
curl -X POST -u "Admin:IhrPasswort" -d "dom.GetObject(\"HmIP-RF\");" http://127.0.0.1:8181/rega.exe

ls /usr/local/etc/config/addons/homekit-ccu/

tail -f /var/log/homekit-ccu.log 
```

# Icon
the icon was made by @roe1974


