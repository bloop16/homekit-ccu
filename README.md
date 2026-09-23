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

This RaspberryMatic / OpenCCU / CCU3 addon will allow you to access your HomeMatic devices from HomeKit. Its much like https://github.com/thkl/homebridge-homematic but without homebridge.
All this runs on your RaspberryMatic / OpenCCU / CCU3. You will not need any extra hardware.

Requires Node.js >= 20. OpenCCU and RaspberryMatic ship Node.js as part of the system image. If Node.js is missing or too old, the addon will automatically download and install a compatible version during installation.

# What's new in 0.0.16

- Fixed HomeKit device discovery on OpenCCU (switched mDNS advertiser from ciao to bonjour-hap)
- Fixed Rega communication: socket hang-ups resolved by disabling HTTP keep-alive connection reuse
- Rega retry logic fixed — counter was stuck at "1/3"; now correctly retries and gives up after 3 attempts
- Rega requests serialised with 150ms cooldown between calls to avoid overloading single-threaded ReGaHss
- Per-caller Rega log tags for easier debugging (e.g. `[Rega] [getValue]`, `[Rega] [fetchRooms]`)
- HomeKit Instances UI: action buttons now responsive — icons only on small screens, full labels on medium+
- Addon installer runs in background — CCU WebUI no longer times out during install
- flock-based install locking prevents parallel installs
- Dynamic status in CCU System Control: shows install progress, hides buttons during install
- npm install failures are now detected and logged instead of silently continuing
- Log date format aligned between rc.d script and Node.js server

# What's new in 0.0.15

- Renamed from **hap-homematic** to **homekit-ccu**
- npm package is now bundled inside the addon tar — no internet access required on the CCU at install time
- Node.js version is shown alongside the addon version in CCU System Control
- OpenCCU compatibility improvements
- Rega communication refactored with request queuing and automatic retry
- Improved error handling across all CCU/RPC layers — fewer silent failures and crashes
- Removed npm registry version check (no internet needed on CCU)
- Safer addon installer scripts with proper service restart on update
- Lighttpd proxy config reorganized with explicit SSL settings

# Installation
Download the latest addon (homekit-ccu-x.x.xx.tar.gz) from https://github.com/britz/homekit-ccu/releases/latest/ and install it via system preferences to your ccu.

A little bit later (the addon will install all other needed software) you will have a HomeKit button in your ccu system preference page.

This will not run on a older CCU2 model.

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

* 9874 -> Config WebUI (proxied through lighttpd)
* 49874 -> Config WebUI HTTPS (proxied through lighttpd)
* 9875 -> RPC event server
* 9876 -> RPC event server CuxD (optional)
* 9877..n HAP Instance 0 .. n

Ports 9874 and 49874 are automatically opened in the CCU firewall during addon installation.

# Architecture

homekit-ccu connects to these CCU endpoints:

| Port | Service | Endpoint | Purpose |
|------|---------|----------|---------|
| 8181 | Rega | POST `/tclrega.exe` | Device/variable/program enumeration via TCL scripts |
| 2001 | BidCos-RF | XML-RPC | Classic HomeMatic RF devices |
| 2010 | HmIP-RF | XML-RPC | HomeMatic IP devices |
| 9292 | VirtualDevices | XML-RPC | Virtual/grouped devices |
| 80/443 | JSON-RPC | POST `/api/homematic.cgi` | Authentication, session management |

Key source files:
- `lib/HomeMaticCCU.js` — CCU connection manager, interface discovery, port mapping
- `lib/HomeMaticRPC.js` — XML-RPC/BinRPC event handling (port 9875)
- `lib/HomeMaticRegaRequest.js` — HTTP POST to Rega at `:8181/tclrega.exe`
- `lib/configurationsrv/ccu.js` — JSON-RPC auth, TLS, firewall config reader
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
You can use your ccu user management as an optional authentication for homekit-ccu. If you turn on this feature, you have to call the configuration page from your ccu webUI system preference page to use a valid session. Only ccu admins are alowed to use the homekit-ccu configuration page if authentication was turned on.

# Concept of rooms
HAP the homekit accessory protocol does not know a room concept. So when you add one or more devices to a bridge the will appear at the same room as the bridge in your homekit client application. Therefore homekit-ccu is able to fire up multiple bridges (hap instances). During the installation wizzard you may add a instance for each of your rooms, add theese instances to homekit and put them into rooms. From this time on adding a new device to an instance will place this device into the same room as your brigde.

# FakeGato History
All generated homekit devices will support fakegato history (if there is a history option in eve). 
Please note: History is only available if u are using the eve app as a homekit controller.

# Development

```bash
npm install          # install dependencies
npm test             # run tests
node index.js -D     # run in debug mode (expects CCU on localhost)
node index.js -D -H <host>  # run against remote CCU
```

## Devcontainer

A devcontainer in `.devcontainer/` provides a full OpenCCU environment for development and debugging. It runs a single container based on the OpenCCU image with Node.js layered on top, using Podman.

```bash
# Probe all CCU endpoints to see what works/fails
.devcontainer/scripts/test-ccu-api.sh

# Install homekit-ccu as a proper CCU addon (symlinks workspace source)
.devcontainer/scripts/install-addon.sh

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
Please open an issue [here](https://github.com/britz/homekit-ccu/issues/new) for all what went wrong. If you just have a question or want to know something consider to open a thread in [Discussions](https://github.com/britz/homekit-ccu/discussions)

# Documentation
Please find the documentation in the [wiki](https://github.com/britz/homekit-ccu/wiki)

## Useful commands for debugging

```shell

# re-deploy lighttpd conf
cp /usr/local/addons/homekit-ccu/node_modules/homekit-ccu/etc/homekit_ccu.conf /usr/local/etc/config/lighttpd/homekit_ccu.conf 
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


