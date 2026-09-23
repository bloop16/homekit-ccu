# homekit-ccu Kern-Upgrade – Design

Datum: 2026-09-23
Status: freigegeben
Repo: https://github.com/bloop16/homekit-ccu (Fork von Britz/homekit-ccu, upstream inaktiv seit 2026-04-11)

## 1. Ausgangslage

homekit-ccu ist ein OpenCCU-Addon, das HomeMatic- und HomematicIP-Geräte per HomeKit Accessory Protocol (HAP) in Apple Home bringt. Es stammt von thkl/hap-homematic (archiviert, letztes Release 0.0.14 im Oktober 2020) und wurde im April 2026 von Jochen Britz auf OpenCCU angepasst (0.0.15/0.0.16). Seitdem gibt es keine Commits, keine Releases und keine Issues.

Technischer Stand:

- `hap-nodejs` 0.11.1 (April 2023). Aktuell ist `@homebridge/hap-nodejs` 2.2.3 (August 2026) mit Sicherheitsfixes und Fixes für tvOS-26.x-Probleme bei Root-Bridges.
- Veraltete Dependencies: commander 5, formidable 1, moment 2.29, fakegato-history 0.5.6. `npm audit` meldet 6 Findings.
- Die Video-Klingel nutzt `hap.StreamController`, das seit HAP-NodeJS 1.0 nicht mehr existiert.
- 339 Mocha-Tests laufen grün unter Node 22.
- Ziel-Plattform OpenCCU 3.89 (Buildroot 2026.08) liefert Node.js 22.23.2, npm und avahi, aber kein ffmpeg. Der Addon-Installer wird von OpenCCU mit dem Plattform-String `HM-RASPBERRYMATIC` aufgerufen.

Verifizierte Brüche beim Sprung auf `@homebridge/hap-nodejs` 2.2.3:

| Bruch | Stellen | Folge |
|---|---|---|
| `util.inherits` + `Characteristic.call(this)` in `CustomHomeKitTypes.js` | 1 Datei, 7 Nutzer | Wirft `Class constructor Characteristic cannot be invoked without 'new'` |
| `Characteristic.Formats/Perms/Units` | 82 | Undefined; Enums liegen jetzt auf Top-Level (`hap.Formats` usw.) |
| `hap.StreamController` in `ffmpeg.js` | 1 Modul | Entfernt, Ersatz ist `CameraController` mit `CameraStreamingDelegate` |
| `on('get')`/`on('set')` | 263 | Funktioniert in 2.x weiterhin, keine Änderung nötig |
| `Characteristic.getValue(cb)` | ~110 (nur Tests) | Entfernt; Test-Helfer `test/helpers/characteristicValue.js` auf Basis von `handleGetRequest()` |
| `Service.BatteryService` | lib + Tests | Heißt jetzt `Service.Battery` (gleiche UUID 00000096) |
| `Accessory.setPrimaryService(s)` | 2 Motion-Accessories | Jetzt `service.setPrimaryService()` |
| `Accessory.updateReachability(v)` | HomeMaticAccessory | Entfernt; Zuweisung an `accessory.reachable` |
| Default-Wert von Custom-Characteristics | CustomHomeKitTypes | 2.x setzt keinen Default; Konstruktor setzt `this.value = this.getDefaultValue()` selbst |

iOS 27 bringt für HAP-Bridges keine Protokolländerungen. Der neue Energie-Tab wird ausschließlich aus Matter-Clustern gespeist; HAP kennt keine Energie-Characteristics. Matter ist bewusst nicht Teil dieser Iteration.

## 2. Ziel und Nicht-Ziele

Ziel: Ein OpenCCU-Addon, das mit aktuellem HAP-Stack unter iOS 27 zuverlässig pairt und läuft, ein reproduzierbares Release über GitHub Actions hat und keine bekannten Schwachstellen mitbringt.

Nicht-Ziele dieser Iteration:

- Matter-Bridge oder Energie-Tab
- Neue Konfigurations-UI (jQuery/Bootstrap bleibt)
- Zerlegen von `Server.js` (1380 Zeilen) und `HomeMaticCCU.js` (1182 Zeilen)
- Eigenes Node.js-Bundle im Addon
- Support für CCU2, RaspberryMatic-Versionen mit Node unter 22, oder Node unter 22 generell

## 3. Repo und Release

- Fork unter `bloop16/homekit-ccu`, lokaler Checkout `/home/martin/homekit-ccu`, Remote `upstream` zeigt auf Britz.
- Arbeit auf Feature-Branches gegen `master`, Merge per Pull Request im eigenen Fork.
- Version springt auf `0.1.0`.
- Workflow `ci.yml`: bei Push und Pull Request auf Node 22 `npm ci`, `npm run lint` (standard), `npm test`.
- Workflow `release.yml`: bei Tag `v*` baut `addon_installer/genscript.sh` das Tarball und hängt es an ein GitHub-Release. Versionsquelle bleibt `package.json`.
- Das eingecheckte `addon_installer/homekit-ccu-0.0.16.tar.gz` und `.travis.yml` werden entfernt. README-Badges zeigen auf die neuen Workflows.

## 4. HAP-Migration

- `hap-nodejs` 0.11.1 wird durch `@homebridge/hap-nodejs` ^2.2.3 ersetzt. Alle `require('hap-nodejs')` werden angepasst.
- `Characteristic.Formats`, `.Perms`, `.Units` werden mechanisch auf `hap.Formats`, `hap.Perms`, `hap.Units` umgestellt.
- `CustomHomeKitTypes.js` erzeugt Custom-Characteristics und -Services als ES-Klassen (`class extends hap.Characteristic`, `class extends hap.Service`). Die öffentliche Schnittstelle `createCharacteristic(name, uuid, props)` und `createService(name, uuid, characteristics, optionals)` bleibt, damit die sieben Eve-/FlowerCare-Module unverändert bleiben.
- fakegato-history auf ^0.6.7.
- mDNS-Advertiser: Default bleibt `bonjour-hap` (hat auf OpenCCU laut 0.0.16 die Discovery repariert). Neu: Konfigurationsschlüssel `advertiser` mit den Werten `bonjour-hap`, `ciao`, `avahi`, damit auf der OpenCCU verglichen werden kann. OpenCCU liefert avahi mit.
- Manufacturer-String zeigt auf `github.com/bloop16/homekit-ccu`.
- Alle 339 bestehenden Tests müssen nach dieser Stufe grün sein.

## 5. Dependencies

| Paket | Vorher | Nachher | Bemerkung |
|---|---|---|---|
| commander | ^5.1.0 | ^14 | Nur in `index.js`; Option-API prüfen |
| formidable | ^1.2.2 | ^3 | Eine Aufrufstelle in `configurationsrv/index.js` (Upload); `fields`/`files` sind in v3 Arrays |
| moment | 2.29.4 | entfernt | Alle 12 Aufrufe sind `moment().unix()`; Ersatz `lib/util/time.js` mit `nowUnix()` |
| fakegato-history | ^0.5.6 | ^0.6.7 | |
| mocha | ^11.3.0 | bleibt | |
| c8 | – | neu (dev) | Coverage |
| chalk 4, sockjs, binrpc, homematic-xmlrpc | | bleiben | chalk 4 ist die letzte CommonJS-Version |

Ziel: `npm audit` ohne Findings, `standard` ohne Fehler, `engines.node` auf `>=22`.

## 6. Video-Klingel (CameraController)

Neues Modul `lib/services/camera/`:

- `StreamingDelegate.js` implementiert `CameraStreamingDelegate`: `handleSnapshotRequest` (ffmpeg liefert JPEG von `stillImageSource`), `prepareStream` (SRTP-Schlüssel, Ports, Session-Info), `handleStreamRequest` (START/RECONFIGURE/STOP). Sessions werden in zwei Maps (pending, ongoing) geführt.
- `FfmpegProcess.js` kapselt `child_process.spawn`, Start-Timeout, Beenden per SIGKILL bei STOP oder Fehler, Logging von stderr im Debug-Modus.
- `buildFfmpegArgs.js` ist eine reine Funktion: aus `StartStreamRequest`, Session-Info und Einstellungen entsteht das Argument-Array. Keine Seiteneffekte, vollständig testbar.
- `HomeMaticSPVideoDoorBellAccessory.js` erzeugt `new hap.CameraController({ cameraStreamCount: 2, delegate, streamingOptions })` und hängt ihn per `configureController` an das Accessory. Doorbell-Service und Klingel-Taster (`address_door_bell_key`) bleiben. Das bisherige `LockMechanism` entfällt, weil es ein Dummy ohne CCU-Anbindung war.
- Streaming-Optionen Video: `supportedCryptoSuites` AES_CM_128_HMAC_SHA1_80, H.264 Profile Baseline/Main/High, Level 3.1/3.2/4.0, Auflösungen 320x180 bis 1920x1080.
- Audio: Der Controller bietet Opus und AAC-ELD an (Sample-Rate 16 kHz, mono). Die Kamera-Tonspur aus `video_source` wird per ffmpeg in den vom Request gewählten Codec transkodiert und als zweiter SRTP-Stream gesendet. Opus nutzt `libopus`, AAC-ELD `libfdk_aac`. Beim Start prüft `FfmpegProcess.probeEncoders()` einmalig per `ffmpeg -encoders`, welche Encoder vorhanden sind; nicht verfügbare Codecs werden nicht angeboten, fehlt beides, wird ohne Audio veröffentlicht und eine Warnung geloggt.
- Zwei-Wege-Audio (Sprechen an der Klingel): aktiv, sobald `audio_return_target` gesetzt ist. Dann meldet der Controller `twoWayAudio: true`, `prepareStream` liefert einen Rückkanal-Port, und ein zweiter ffmpeg-Prozess empfängt den SRTP-Rückstrom per SDP-Datei und schreibt ihn an das Ziel (z. B. `rtsp://` oder `alsa`-Ausgabe der Kamera). Ohne `audio_return_target` bleibt es bei Einweg-Audio.
- Einstellungen: bestehend `video_source`, `video_stillImageSource`, `ffmpegpath`, `pin-code`; neu `maxWidth`, `maxHeight`, `maxFPS`, `maxBitrate` mit Defaults 1280, 720, 15, 1000, `vcodec` (Default `libx264`, `copy` für Kameras, die bereits H.264 liefern, was auf Raspberry-Pi-CCUs die einzige realistische Option ist), sowie `audio` (bool, Default true) und `audio_return_target` (String, Default leer).
- Vorlage: Muster von homebridge-camera-ffmpeg inklusive dessen Audio- und Return-Audio-Teil, ohne HKSV.
- Dokumentation: OpenCCU bringt kein ffmpeg mit. README beschreibt, dass ein statisches ffmpeg-Binary (z. B. johnvansickle-Build) auf die CCU kopiert und der Pfad gesetzt werden muss, und dass der Remote-Modus die einfachere Wahl ist.

Fehlerbehandlung: fehlendes Binary wird beim Start geloggt und das Accessory nicht veröffentlicht. ffmpeg-Absturz (Video, Audio oder Rückkanal) beendet nur die betroffene Session (`controller.forceStopStreamingSession`) und alle ihre Prozesse, nie den Server. Ein fehlender Audio-Encoder degradiert auf reines Video statt zu scheitern.

## 7. Installer

- `addon_installer/homekit-ccu`: `REQUIRED_MAJOR=22`, `NODE_VER` wird aus `node --version` gelesen statt fest eingetragen.
- README: Aussage über automatisches Nachinstallieren von Node entfällt; Voraussetzung ist OpenCCU 3.89 oder neuer.
- `update_script`, Plattform-Check, lighttpd-Proxy und Firewall-Handling bleiben wie in 0.0.16.

## 8. Tests

- Bestehende 339 Tests laufen in CI.
- Neu: `test/100_custom_types.js` (Klassen-Factory erzeugt Instanzen mit korrekten Props), `test/101_ffmpeg_args.js` (Argument-Builder für Snapshot, Start mit und ohne Audio, Opus und AAC-ELD, Rückkanal-SDP, verschiedene Auflösungen), `test/102_streaming_delegate.js` (Delegate mit Fake-ffmpeg-Skript unter `test/fixtures/fake-ffmpeg.sh`: Start, Stop, Timeout, Absturz).
- Coverage mit c8, Ziel 80 % auf `lib/services/camera/` und `CustomHomeKitTypes.js`.
- Lint mit standard ist Teil von `npm test` in CI.

## 9. Stufen und Abnahme

Reihenfolge, jede Stufe ist ein eigener Branch und nach Merge releasefähig:

1. Pipeline: CI, Release-Workflow, Tarball und Travis entfernen, Version 0.1.0-dev.
2. HAP-Migration (Abschnitt 4), Tests grün.
3. Dependencies (Abschnitt 5), audit und lint sauber.
4. Video-Klingel (Abschnitt 6) mit Tests.
5. Installer und README (Abschnitt 7).
6. Release `v0.1.0`.

Abnahme auf Martins produktiver OpenCCU nach Stufe 2 und nach Stufe 4 (SSH-Zugang wird vorher erfragt):

- Tarball installiert sich über die WebUI, Button erscheint in der Systemsteuerung.
- Bridge wird in Apple Home unter iOS 27 gefunden, Pairing gelingt.
- Bestehende Geräte reagieren, Events kommen an.
- Video-Klingel liefert im Remote-Modus mit ffmpeg Standbild, Stream und Ton. Da keine echte Kamera vorhanden ist, dient eine synthetische lavfi-Quelle (Testbild plus Sinuston) als Kamera; das Feld `video_source` akzeptiert dafür rohe ffmpeg-Eingabeargumente. Gegensprechen wird nur bis zum Start des Rückkanal-Prozesses geprüft (Ziel `-f null -`), nicht bis zu einer Kamera.
