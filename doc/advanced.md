# Advanced topics

## Bridges and rooms

HAP the homekit accessory protocol does not know a room concept. So when you add one or more devices to a bridge they will appear at the same room as the bridge in your homekit client application. Therefore homekit-ccu is able to fire up multiple bridges (hap instances). During the installation wizard you may add an instance for each of your rooms, add these instances to homekit and put them into rooms. From this time on adding a new device to an instance will place this device into the same room as your bridge.

## Eve history

All generated homekit devices will support fakegato history (if there is a history option in eve). 
Please note: History is only available if you are using the Eve app as a homekit controller.

## mDNS advertiser

`config.json` accepts `"advertiser"` with `bonjour-hap` (default, works on OpenCCU), `ciao` or `avahi` (uses the CCU's avahi daemon via D-Bus). Change it only if HomeKit cannot discover the bridge. An unknown value falls back to `bonjour-hap` with a warning in the log.

## Architecture

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

## OpenCCU compatibility

OpenCCU (formerly RaspberryMatic v3.87+) introduced several changes that affect homekit-ccu:

1. **64-bit only** — Dropped support for Pi0/Pi1/Pi2/armv7
2. **Lighttpd proxying** — XML-RPC ports 2001/2010/9292 are now proxied through lighttpd; secured variants on 42001/42010/49292
3. **Rega remote scripting** — Blocked on ports 80/443, only works on 8181/48181
4. **Port architecture** — Internal daemons listen on 32001 (rfd), 32010 (crRFD), 39292 (HMServer). Lighttpd proxies external ports: `external = internal - 30000`. Rega `InterfaceUrl()` reports internal ports; homekit-ccu remaps them automatically.
5. **Authentication changes** — New lighttpd-based auth against ReGaHss, optional basic auth on XML-RPC
6. **WebUI translation patching** — Changes to `/webui/js/lang/<lang>/translate.lang.extension.js`
