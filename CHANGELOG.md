Changelog for 0.1.0:
====================

* Migrated from hap-nodejs 0.11.1 to @homebridge/hap-nodejs 2.2.3 (custom characteristics as ES classes, Formats/Perms/Units enums, Categories)
* Video doorbell rewritten on CameraController: snapshot, stream, Opus/AAC-ELD audio, optional two-way audio via `audio_return_target`; ffmpeg encoder probe decides offered codecs
* Removed the dummy LockMechanism from the video doorbell
* `advertiser` config key (bonjour-hap, ciao, avahi)
* commander 14, formidable 3, fakegato-history 0.6.7; moment replaced by lib/util/time.js
* standard lint clean, c8 coverage script, husky removed
* GitHub Actions CI and release workflow; addon tarball no longer tracked in git
* Installer requires Node.js 22 (OpenCCU 3.89+), README no longer claims automatic Node install; the add-on info shows the Node.js version actually installed
* Update check in the CCU's add-on list reads the latest release of bloop16/homekit-ccu; repository, WebUI and issue links point at the fork
* Restart from the configuration UI calls the rc.d script directly; configuration restore checks the CCU session when authentication is on and removes rejected uploads
* **Upgrade note, video doorbell:** the doorbell gets a new HomeKit identity (derived from its UUID instead of the fixed `00:00:11:22:22:11`) and the old default PIN `123-45-678` is now rejected as trivial. After upgrading: set a non-trivial PIN in the doorbell settings, remove the old doorbell in Apple Home, add it again. Renaming the doorbell also changes its identity.
* Video doorbell: streams end automatically when no RTCP from the viewer arrives (watchdog: 30 s for the first packet, then ~10 s); ffmpeg errors are shown in the log with credentials (URL userinfo, `user`/`password` query parameters) and SRTP keys masked; snapshots cached 5 s
* Addon tarball bundles all npm dependencies (`bundleDependencies`), installation on the CCU works without internet access (tarball ~3.5 MB, ~15 MB installed)
* Hardware verification on OpenCCU + iOS 27: pending (pairing migration from 0.0.x, bridges, video doorbell)
* binrpc 4.3 (no `binary`/`put` dependencies, fragmented TCP frames, no CPU spin on refused connects) and homematic-xmlrpc 2.0 (built-in XML writer, byte-identical output); mocha 12, c8 12 (commander stays on 14, the last CommonJS release, so any Node.js 22 works); `npm audit`: 0 vulnerabilities
* RPC event servers: errors of the socket servers are logged instead of ending the process, a remote call named `error` no longer crashes it, and the CUxD BIN-RPC server is closed on shutdown (it was never closed)
* RPC smoke test: XML-RPC and BIN-RPC calls in both directions against fake CCU daemons; a test on a real CCU is still pending
* fakegato-history (Eve history) is vendored in `lib/vendor/fakegato-history` without its Google-Drive storage, which homekit-ccu never used (history is stored on the filesystem); googleapis and its dependencies are no longer bundled, the addon tarball shrinks from ~23 MB to ~3.5 MB (~240 MB to ~15 MB installed). A test keeps googleapis out of the bundle
* Security: config API requires a valid CCU session by default, also on the CCU; CORS restricted to same origin; update-check.cgi no longer accepts query-string variable injection. The websocket needs the session too, the session check in remote mode asks the CCU given with `-H` instead of localhost, and a failed session renewal no longer ends the config server
* Installer: a half-installed addon directory is removed before `npm i`; a failed npm install or a missing `index.js` stops the installation (no "Installation complete", no start); the Node.js check runs before the WebUI button is removed; BusyBox-compatible redirections. Config server: a request for a directory answers 404 instead of ending the config server, file read errors answer 500. The log goes to `/var/log/homekit-ccu.log` (or `-L <dir>`) when writable; the check never worked, so it always went to `/tmp`. update-check.cgi passes on only a version-shaped release tag

Changelog for 0.0.16:
====================

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

Changelog for 0.0.15:
====================

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

Changelog for 0.0.64:
====================

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

Changelog for 0.0.63:
====================

* Just one BugFix (in some cases the ui will not get devices from core)

Changelog for 0.0.62:
====================

* mostly bugfixes
* added HmIP-BSL Lights
* added variable based Light sensor


Changelog for 0.0.61:
====================

* added HmIP-DLD
* a backup file name will now contain the current date in the name
* some bugfixes

Changelog for 0.0.60:

* fixed the admin changelog bug
* added HmIP-SCTH230
* fixed var trigger helper generator
* fixed a crash that may occur when there are multiple service UUIDs in one instance
* temp sensor for HmIP-SRD is now optional
* added HomeMaticVariableBinarySwitchAccessory to use variables as other than switches (Fan / Lightbulb ...)
* added voltage level for MULTI_MODE_INPUT_TRANSMITTER

Changelog for 0.0.59:
=====================

* added HM-ES-TX-WM
* DIMMER are now available as Homekit FANs
* added HmIP-STE2-PCB
* first Test HmIP-HDM1
* Bug fixes
* introducing some fresh new bugs


Changelog for 0.0.58:
=====================

* Bug Fixes for Thermometer and Weather Station
* added HmIP-DSD-PCB
* auto refresh for cached ccu data on at the point the user loads the ui
* added HmIP-SRD


Changelog for 0.0.57:
=====================

* restore from backup will also restore the accessory infos for an existing homekit mapping
* new : reset of an instance
* added SIMPLE_SWITCH_RECEIVER to support garage door drives
* added all types of Keys as a Trigger for a Motion sensor
* support for HM-SwI-3-FM 
* support for HM-LC-DW-WM
* better HmIP-MOD-HO support
* BugFixes
* some fresh new Bugs


Changelog for 0.0.56:
=====================

* BugFixes

Changelog for 0.0.55:
=====================

* Bug fixes
* new Instances are now able to setup by using the qr code
* added some new device types


Changelog for 0.0.54:
=====================

* Bug Fixes
* customizable lock mode for Keymatic 
* CCU Temperature Chart 

Changelog for 0.0.53:
=====================

* fixed a problem that some installations are not able to create or edit devices anymore

Changelog for 0.0.51:
=====================

* worked on some timing issues

Changelog for 0.0.50:
=====================

* added multiple key device
* added http device
* fixed a bug in garage door


Changelog for 0.0.49:
=====================

* fixed a bug that some installations are not able to add new devices
* fixed a bug that special devices are not added anymore


Changelog for 0.0.48:
=====================

* bugfixes
* garage door datapoint now have selectors
* devices can be assigned to multiple hap instances

Changelog for 0.0.47:
=====================

* pimped dimmers
* garage door service has no onTime settings
* added variable based devices
* fixed some bugs


Changelog for 0.0.46:
=====================

* removed a bug in BROLL

Changelog for 0.0.45:
=====================

* eve thermo for HM-TC-IT-WM-W-EU
* fix for garage service
* some other bug fixes
* new problems new bugs 

Changelog for 0.0.44:
=====================

* flexible Alarm System
* Thermostats have not Off/Manu/Auto Modes
* Blinds with Slats
* some bugfixes
* even more new bugs


Changelog for 0.0.43:
=====================

* optional Co2 Variable for Thermometer
* some UI BugFixes
* alarm system will now send pushes
* other bug fixes
* introduced fresh new bugs

Changelog for 0.0.42:
=====================

* the welcome wizzard is back after a short visit at the beach 

Changelog for 0.0.41:
=====================

* changed WebUI to use WebSockets (beta)
* added Battery Indicators
* fixed evehistory for variables and ccu temp sensor
* fixed HmIP-MOD-HO

Changelog for 0.0.40:
=====================

* bugfix

Changelog for 0.0.39:
=====================

* some bug fixes and improvements 

Changelog for 0.0.38:
=====================

* Added a config backup
* Monitoring is now optional
* Bugfix for variables and programs with : in names
* Bugfix HmIP RadiatorThermostate
* Special device Garagedoor opener will now work with KEY devices
* Added HmIP-SWO-*
* Removed HmIP-ASIR support cause there is no need
* Fixed WinMatic


Changelog for 0.0.37:
=====================

* added optional ramp time for dimmers thanks to @comtel2000
* new hap instances will be named as HomeMatic .... (removed the _ ) thanks to @detLAN for researching this
* added a support dialog for new devices and issues


Changelog for 0.0.36:
=====================

* added HmIP-SWD

Changelog for 0.0.35:
=====================

* added HmIP-SWO-*
* added HmIP-STHO, 
* added HmIP-SRH
* added HmIP-SAM(Contact version)

Changelog for 0.0.34:
=====================

* Fix for Instances/Settings

Changelog for 0.0.33:
=====================

* some tweeks for the webUI

Changelog for 0.0.32:
=====================

* added sorting for webui lists
* implemented a nicer update button

Changelog for 0.0.31:
=====================

* only setup the monitor if system is not in debug and there was a pid file created by the launcher

Changelog for 0.0.30:
=====================

* homekit-ccu will install a config for the raspberrymatic monitoring service (if there is one)
* added variable based thermometers
* new special device which will show the ccu core temperature

Changelog for 0.0.29:
=====================

* WebUI Fixed Internals in left menu
* Fixed AlarmSystem (internal vs night mode)

Changelog for 0.0.28:
=====================

* prevent the system from crash on invalid GarageDoorSensors configuration
* changed State() to Value() for fetching data from ccu
* added JALOUSIE channel to blind accessories
* removed fault characteristics from leak sensor (there is no such datapoint)

Changelog for 0.0.27:
=====================

* changed a https client call - for backwards compatibility to old node8 version on ccu3 devices

Changelog for 0.0.26:
=====================

* added special devices
* fixed CCU startup bug
* added optional ccu authentication for configuration page
* added optional https transport for configuration page

Changelog for 0.0.25:
=====================

* Added IP Blinds

Changelog for 0.0.24:
=====================

* Added WinMatic
* Changed Plugin installer to prevent backing up all the stuff (RaspberryMatic Only)

Changelog for 0.0.23:
=====================

* Bugfix for devices with service configuration like devtype:channeltype
* added a testmode

Changelog for 0.0.22:
=====================

* the webUI is now able to show the changelog
* more interal logging


Changelog for 0.0.21:
=====================

* fixed a bug, which prevents the plugin from knowing about some smoke detectors
* added a listener, to "newDevice" event on the interface, so the plugin will query the ccu for new devices, as the are teached in the ccu
