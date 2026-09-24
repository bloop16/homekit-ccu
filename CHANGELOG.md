# Changelog

All notable changes to HomeKit-CCU are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Versions up to 0.0.64 are those of hap-homematic.

## [0.1.0] - unreleased

First release of the fork for OpenCCU 3.89+ (Node.js 22.12+). Moving from hap-homematic is
described in [doc/upgrading.md](doc/upgrading.md).

### Added
- Multi-gang switch actuators (e.g. HmIP-DRSI4, HmIP-BS2, HMW-IO-12) can become one Apple Home accessory with a switch per output, chosen per device in "new device" and in the setup assistant. The outputs share one room; Apple Home can still show them as separate tiles. Off by default, existing accessories stay as they are.
- New devices: HmIP-SWSD-2/-3 smoke detectors, Door Lock Drive Pro (DLP) and door lock sensor (DLS), irrigation valve (WSM) with run time, water stop (WSS), particulate sensor (SFD) as air quality, CO₂ traffic light HM-CC-SCD, window drive (MOD-WD-VK), presence detector (SPI) as occupancy sensor, sirens (ASIR) as an alarm switch, HmIP-ESI energy sensor (Eve), alarm actuator HM-Sec-SFA and door controller outputs.
- Remotes and wall buttons as one accessory with numbered buttons (ServiceLabel), instead of one accessory per key.
- Venetian blind tilt for HM-LC-Ja1PBU, colour temperature for HmIP-RGBW/LSC/E27/GU10, a latch "Open" switch and jammed state for the KeyMatic, a separate humidity sensor for wall thermostats.
- [Device list](doc/devices.md) with every supported family and how it looks in Apple Home.
- Thermostats (HmIP-eTRV, HmIP-WTH, heating groups, HM-CC-RT-DN, HM-TC-IT): heating state from the valve position, Eve valve position, "No Response" while unreachable.
- "No Response" in Apple Home for every HomeMatic device while the CCU reports it unreachable.
- Battery service for all battery-powered sensors that report LOW_BAT; StatusTampered and StatusFault for contacts, smoke detectors and other devices that report sabotage or errors.
- HoldPosition for HomematicIP blinds, CarbonDioxideSensor for the HmIP-SCTH230, "in use" for measuring plugs from their power.
- Accessory information as Apple expects it: manufacturer eQ-3, model = device type, serial number = channel address, firmware version read from the device.
- Light, dark and automatic theme in the configuration UI.
- Private security reports (SECURITY.md), Dependabot, CI on Node.js 22 and 24.

### Changed
- New special devices start with the choice of their kind (video doorbell, garage door, HTTP switch, ...) and then show only the settings of that kind; rarely needed ones (ffmpeg, video size, actor delays) stay folded. Editing keeps the kind. The list shows readable kinds.
- Setup assistant, first entry of the menu and started on a new installation: proposes bridges from the CCU rooms (one per room, per floor or one for everything, small rooms on a shared bridge, locks and alarm on a bridge of their own) and the devices of the chosen functions. Bridges, rooms, devices, channels, names and Apple Home types stay changeable; a preview shows the result. New bridges start without devices, the assistant shows their QR codes and pairing state, then publishes the devices so they land in the room of their bridge. Devices already in HomeKit are never moved. It replaces the welcome wizard.
- Native defaults when a device is added: contacts as contact sensors, buttons as programmable buttons, wall thermostats as thermostats, plugs as outlets, switch actuators as switches, rain sensors as leak sensors, garage drive lights as lightbulbs. Devices that are already set up keep their type.
- Weather stations always show temperature, humidity and light natively in Apple Home; wind, rain and pressure stay in the Eve app. Multi-service accessories mark their main service, so Apple Home shows the right tile.
- HomeKit core: @homebridge/hap-nodejs 2.2 (was hap-nodejs 0.11), video doorbell on CameraController with Opus/AAC-ELD audio and optional two-way audio (`audio_return_target`), `advertiser` setting (bonjour-hap, ciao, avahi).
- Bridges are called "HomeKit-CCU" and "HomeKit-CCU <instance>"; accessory names follow Apple's rules. Accessory identities are unchanged, so rooms, scenes and automations stay.
- Battery level scales between empty and full cells instead of dividing by the nominal voltage.
- "New device" lists devices instead of single channels: search across device, channel, room and serial, a room filter, devices already in HomeKit and the second and third virtual channel of HomematicIP outputs hidden until asked for. Ticking a device selects its useful channels; the keys of a remote are one row. A second step sets name, Apple Home type (e.g. switch, outlet or light) and bridge for all chosen channels, which are saved at once. Each device shows its picture from the CCU WebUI; filters for CCU function (Gewerk), kind of device and radio system; the virtual CCU keys (HM-RCV-50, HmIP-RCV-50) are hidden until asked for.
- Configuration UI on Bootstrap 5.3 with a responsive layout; jQuery 4, Chart.js 4, sockjs-client 1.6, showdown 2.1 with DOMPurify, qrcode-generator 2.0. "HomeKit Instances → Settings" is now "Publish devices".
- The configuration UI and its API require a CCU administrator session, also on the CCU; `config.json` gets `"configVersion": 2`, which turns the check on once for configurations from hap-homematic.
- Moving from hap-homematic works through its backup: the installer refuses to run while hap-homematic is installed; restoring a backup brings back configuration and HomeKit pairing.
- Installer: only OpenCCU, Node.js check before anything is copied, offline installation from the bundled package (about 3.5 MB), log in `/var/log/homekit-ccu.log` with rotation at 2 MB, monit service `HomekitCCU`.
- Dependencies: commander 15, formidable 3, binrpc 4.3, homematic-xmlrpc 2.0, fakegato-history 0.6.7 vendored without Google Drive; moment and chalk replaced by Node.js built-ins. Linting with neostandard (ESLint 9).

### Fixed
- A restored backup never brought back the persistent values of the accessories (the host name was not read correctly). The Support download failed while the session check is on.
- A new special device without an explicitly chosen bridge was on no bridge; it now goes to the first one. A second special device with the same name replaced the first; it is refused. The special device list did not refresh after saving.
- The virtual keys of HmIP-RCV-50 were offered as one remote with 50 buttons; each key is a programmable switch again, as for HM-RCV-50.
- Doorbell buttons (HmIP-DSD-PCB, HmIP-DBB, HM-Sen-DB-PCB) are added as a programmable switch: Apple Home shows a doorbell without a camera as "not supported". The doorbell service stays selectable.
- Saving a device answered before the configuration was written, so publishing right after could miss the change.
- Settings that are on by default could not be switched off permanently in the device dialog.
- Thermostat modes: OFF, HEAT and AUTO switch reliably, HEAT after OFF restores the last temperature, 0.5 °C steps, BidCos valve state no longer ×100, boost switch named "<name> Boost".
- Contacts: tilted and open count as open; "reverse" no longer flips the battery warning; Eve open/closed times.
- Garage doors, door lock drive, blinds, Winmatic, door opener, smoke detectors, weather stations, thermometers, plugs, RGB lights and buttons: correct states and values (details in the git history), no NaN or out-of-range values before the first event.
- Bridge PIN of a new installation changed on every start; bridge reset in the UI never removed the pairing.
- Restoring a backup kept the new keys, so Apple Home no longer recognised the bridge.
- The configuration server no longer ends on a directory request, a failed read or a failed session renewal; RPC event servers survive socket errors.
- Configuration UI: "reset instance" threw before doing anything, a failed save left the device dialog hanging.

### Removed
- The old Express configuration server, the in-UI update flow, the Debmatic instructions, an unfinished duplicate switch class (its devices move to the switch class automatically) and other unused code and images.

### Security
- Names from the CCU are shown as text in the configuration UI; before, a name containing HTML ran as script (stored XSS).
- Setup codes and the content of `config.json` are no longer written to the log; the video doorbell gets a random setup code instead of a fixed default.
- Same-origin CORS for the configuration API, session check for the websocket, update-check.cgi without query-string injection, ffmpeg errors in the log with credentials masked.
- The event servers (9875/9876) only take calls from the CCU and this machine; on the CCU they listen on 127.0.0.1 and port 9875 is closed in the CCU firewall again. Before, any host on the LAN could send fake device states to HomeKit.
- Service class names from the API and from `config.json` (also from a restored backup) must be classes of `lib/services`; a path could reach `require()` before.
- A restore upload is refused before anything is stored unless it carries a valid session (header), one restore at a time; backup and restore use private temp directories that are removed afterwards.
- No CCU session ids, setup codes or URL credentials in the log any more (ReGa scripts, IPC and HTTP switch messages); the log file is readable by root only.
- Without the session check the API only answers requests to an own address or name (DNS rebinding). Bridge ids like `__proto__` and non-numeric channel ids in datapoint queries are refused. The video doorbell only starts a program named ffmpeg.
- Downloads (backup, log, support data) post the session instead of putting it into the URL; the pairing code and port of a bridge are shown as text.
- sockjs (server and browser client, unmaintained) is replaced by long polling over the authenticated API: fewer dependencies, the same live updates.

## [0.0.16]
* Fixed Rega timeout causing full server crash — unhandledRejection now logged without process exit
* Added .catch() to all Rega Promise chains (fetchAllDevices, fetchRooms, hazDatapoint, setValue, setVariable, getVariableValue, runProgram, auth checks) — Rega errors no longer crash the server
* Rega requests are now serialised via a module-level queue — prevents socket hang-ups when Apple Home or the wizard triggers concurrent Rega calls
* Rega script() now retries up to 3 times with 5s delay on transient failures; ping uses 0 retries with 5s timeout
* Rega retry counter fixed — was stuck at "attempt 1/3" due to recursive setTimeout; replaced with async for loop
* Rega HTTP requests now use `Connection: close` and `agent: false` — fixes persistent socket hang-ups caused by Node.js HTTP keep-alive connection reuse against single-threaded ReGaHss
* Rega Content-Length now uses `Buffer.byteLength()` for correct byte count with multi-byte characters
* Rega queue adds 150ms pause between consecutive requests to avoid overloading ReGaHss
* Rega constructor accepts a `tag` parameter for per-caller log context (e.g. `[Rega] [getValue]`, `[Rega] [fetchRooms]`)
* Switched mDNS advertiser from ciao to bonjour-hap — fixes HomeKit device discovery failing on OpenCCU
* pingRega uses a short 5s timeout; unexpected Rega responses are now logged verbatim
* getValue() now fires events on cache hits — fixes registerAddressForEventProcessingAtAccessory needing ignoreCache=true workaround
* Fixed compatibleObjects IPC handler not calling sendObjects() — UI now updates when device list is loaded
* Removed npm registry version check — was always failing (package not public) and logging noise on every UI load
* Fixed console() typo (should be console.log) in configurationsrv shutdown handler
* Removed empty NotFound RPC handler, unused getValue()/callback param in setVariable, empty init() method
* HomeKit Instances UI: 3 overlapping action buttons merged into a responsive btn-group with CoreUI icons; text labels hidden on small screens
* Rega queue now rejects all pending requests when Rega is down — prevents flooding the log with retries from queued requests
* Version check cached — no longer reads package.json on every heartbeat (every 180s)
* Welcome wizard: skip bridges whose room is missing instead of showing "room not found" error
* Welcome wizard: fixed `playload` → `payload` typo breaking instance creation
* Welcome wizard: spelling fixes (recomented → recommended, Num o → Num of, channelzToAdd → channelsToAdd)
* Updated German locale keys to match corrected English strings
* Consolidated all addon lifecycle scripts (install.sh, uninstall.sh, start.sh, preinstall.sh) into single rc.d script
* rc.d script: install/uninstall_app/uninstall_config/start/stop/restart as named functions with dynamic dispatch
* rc.d log(): date format matches server output `[M/D/YYYY, H:MM:SS AM/PM]`; fixed `${@:2}` bashism for BusyBox ash compatibility
* rc.d background_install(): uses flock-based locking to prevent parallel installs; runs in background so CCU WebUI returns immediately
* rc.d status(): reports install and server state via flock lock check and PID file
* rc.d info(): dynamically shows install progress, hides config button and action buttons during install, shows "Server stopped" when not running
* rc.d install(): npm install failure now detected and logged instead of silently continuing with empty module directory
* rc.d stop(): pgrep pattern changed to `node.*homekit-ccu` to avoid killing the installer process
* rc.d run_server(): removed pipe to tee that prevented start-stop-daemon from fully detaching (caused WebUI overlay to hang)
* update_script: install runs in background so CCU WebUI popup returns immediately instead of timing out
* Unsupported platform now fails with error instead of silently exiting

## [0.0.15]
* Renamed project from hap-homematic to homekit-ccu
* npm package is now bundled in the addon tar — no public registry access required at install time
* Version is now derived from package.json as the single source of truth (addon_installer/VERSION removed)
* Node.js version is now shown alongside the addon version in CCU System Control
* Fixed OpenCCU compatibility issues
* Rega communication: added request queue (serializes concurrent requests to single-threaded Rega) and automatic retry with exponential backoff
* Improved error handling: added unhandledRejection handler, .catch() on all Promise chains in CCU/RPC/config layers
* Removed dead code: empty init() method, unused RPC NotFound handler, obsolete _index.js (2034 lines)
* Removed npm registry version check — config UI no longer requires internet access
* Fixed console() typo in configuration service
* Addon installer: safer process killing (xargs -r, error suppression), proper service stop/reinstall on update
* Build script: pre-build cleanup removes stale tarballs
* Lighttpd proxy config: reorganized with section comments and explicit ssl.engine per socket

## [0.0.64]
* OpenCCU compatibility
* Config UI is now proxied through lighttpd (ports 9874 HTTP, 49874 HTTPS) — fixes firewall and iframe issues on OpenCCU
* Addon firewall ports (9874, 49874) are automatically opened/closed on install/uninstall
* Dynamic XML-RPC port remapping for OpenCCU internal daemon ports (32001/32010/39292 → 2001/2010/9292)
* Node.js preinstall check — automatically downloads Node.js 20 if missing or too old
* Minimum Node.js version bumped to >= 20
* Removed vulnerable `ip` npm package (CVE-2024-29415), replaced with built-in Node.js modules
* Fixed `serialize-javascript` prototype pollution vulnerability via dependency override
* Fixed TotalConsumption Eve characteristic (UInt16 → FLOAT) for correct energy readings
* Fixed welcome wizard reopening after completion
* Fixed empty API response parsing error
* Optional basic auth for XML-RPC connections in remote mode (`-U`/`-P` CLI options)
* Config server bind address adapts to local vs remote mode
* Improved error handling for RPC init and translation file loading

## [0.0.63]
* Just one BugFix (in some cases the ui will not get devices from core)

## [0.0.62]
* mostly bugfixes
* added HmIP-BSL Lights
* added variable based Light sensor


## [0.0.61]
* added HmIP-DLD
* a backup file name will now contain the current date in the name
* some bugfixes

## [0.0.60]
* fixed the admin changelog bug
* added HmIP-SCTH230
* fixed var trigger helper generator
* fixed a crash that may occur when there are multiple service UUIDs in one instance
* temp sensor for HmIP-SRD is now optional
* added HomeMaticVariableBinarySwitchAccessory to use variables as other than switches (Fan / Lightbulb ...)
* added voltage level for MULTI_MODE_INPUT_TRANSMITTER

## [0.0.59]
* added HM-ES-TX-WM
* DIMMER are now available as Homekit FANs
* added HmIP-STE2-PCB
* first Test HmIP-HDM1
* Bug fixes
* introducing some fresh new bugs


## [0.0.58]
* Bug Fixes for Thermometer and Weather Station
* added HmIP-DSD-PCB
* auto refresh for cached ccu data on at the point the user loads the ui
* added HmIP-SRD


## [0.0.57]
* restore from backup will also restore the accessory infos for an existing homekit mapping
* new : reset of an instance
* added SIMPLE_SWITCH_RECEIVER to support garage door drives
* added all types of Keys as a Trigger for a Motion sensor
* support for HM-SwI-3-FM 
* support for HM-LC-DW-WM
* better HmIP-MOD-HO support
* BugFixes
* some fresh new Bugs


## [0.0.56]
* BugFixes

## [0.0.55]
* Bug fixes
* new Instances are now able to setup by using the qr code
* added some new device types


## [0.0.54]
* Bug Fixes
* customizable lock mode for Keymatic 
* CCU Temperature Chart 

## [0.0.53]
* fixed a problem that some installations are not able to create or edit devices anymore

## [0.0.51]
* worked on some timing issues

## [0.0.50]
* added multiple key device
* added http device
* fixed a bug in garage door


## [0.0.49]
* fixed a bug that some installations are not able to add new devices
* fixed a bug that special devices are not added anymore


## [0.0.48]
* bugfixes
* garage door datapoint now have selectors
* devices can be assigned to multiple hap instances

## [0.0.47]
* pimped dimmers
* garage door service has no onTime settings
* added variable based devices
* fixed some bugs


## [0.0.46]
* removed a bug in BROLL

## [0.0.45]
* eve thermo for HM-TC-IT-WM-W-EU
* fix for garage service
* some other bug fixes
* new problems new bugs 

## [0.0.44]
* flexible Alarm System
* Thermostats have not Off/Manu/Auto Modes
* Blinds with Slats
* some bugfixes
* even more new bugs


## [0.0.43]
* optional Co2 Variable for Thermometer
* some UI BugFixes
* alarm system will now send pushes
* other bug fixes
* introduced fresh new bugs

## [0.0.42]
* the welcome wizzard is back after a short visit at the beach 

## [0.0.41]
* changed WebUI to use WebSockets (beta)
* added Battery Indicators
* fixed evehistory for variables and ccu temp sensor
* fixed HmIP-MOD-HO

## [0.0.40]
* bugfix

## [0.0.39]
* some bug fixes and improvements 

## [0.0.38]
* Added a config backup
* Monitoring is now optional
* Bugfix for variables and programs with : in names
* Bugfix HmIP RadiatorThermostate
* Special device Garagedoor opener will now work with KEY devices
* Added HmIP-SWO-*
* Removed HmIP-ASIR support cause there is no need
* Fixed WinMatic


## [0.0.37]
* added optional ramp time for dimmers thanks to @comtel2000
* new hap instances will be named as HomeMatic .... (removed the _ ) thanks to @detLAN for researching this
* added a support dialog for new devices and issues


## [0.0.36]
* added HmIP-SWD

## [0.0.35]
* added HmIP-SWO-*
* added HmIP-STHO, 
* added HmIP-SRH
* added HmIP-SAM(Contact version)

## [0.0.34]
* Fix for Instances/Settings

## [0.0.33]
* some tweeks for the webUI

## [0.0.32]
* added sorting for webui lists
* implemented a nicer update button

## [0.0.31]
* only setup the monitor if system is not in debug and there was a pid file created by the launcher

## [0.0.30]
* homekit-ccu will install a config for the raspberrymatic monitoring service (if there is one)
* added variable based thermometers
* new special device which will show the ccu core temperature

## [0.0.29]
* WebUI Fixed Internals in left menu
* Fixed AlarmSystem (internal vs night mode)

## [0.0.28]
* prevent the system from crash on invalid GarageDoorSensors configuration
* changed State() to Value() for fetching data from ccu
* added JALOUSIE channel to blind accessories
* removed fault characteristics from leak sensor (there is no such datapoint)

## [0.0.27]
* changed a https client call - for backwards compatibility to old node8 version on ccu3 devices

## [0.0.26]
* added special devices
* fixed CCU startup bug
* added optional ccu authentication for configuration page
* added optional https transport for configuration page

## [0.0.25]
* Added IP Blinds

## [0.0.24]
* Added WinMatic
* Changed Plugin installer to prevent backing up all the stuff (RaspberryMatic Only)

## [0.0.23]
* Bugfix for devices with service configuration like devtype:channeltype
* added a testmode

## [0.0.22]
* the webUI is now able to show the changelog
* more interal logging


## [0.0.21]
* fixed a bug, which prevents the plugin from knowing about some smoke detectors
* added a listener, to "newDevice" event on the interface, so the plugin will query the ccu for new devices, as the are teached in the ccu
