[🇬🇧 English](../advanced.md) | 🇩🇪 Deutsch

# Fortgeschrittene Themen

## Bridges und Räume

HAP, das HomeKit Accessory Protocol, kennt keine Räume. Apple Home legt ein Gerät, das zu einer Bridge hinzukommt, in den Raum dieser Bridge. homekit-ccu betreibt deshalb mehrere Bridges (HAP-Instanzen): Der Einrichtungsassistent erstellt eine pro CCU-Raum, du fügst jede Bridge in Apple Home hinzu und wählst ihren Raum, und jedes Gerät dieser Bridge landet dort. Siehe [Konfiguration verwenden](configuration.md#räume-warum-eine-bridge-pro-raum).

## Eve-Verlauf

Alle erzeugten HomeKit-Geräte unterstützen den fakegato-Verlauf (sofern Eve für den Gerätetyp einen Verlauf anbietet).
Bitte beachte: Der Verlauf ist nur verfügbar, wenn du die Eve-App als HomeKit-Controller verwendest.

## mDNS-Advertiser

`config.json` akzeptiert `"advertiser"` mit `bonjour-hap` (Standard, funktioniert auf OpenCCU), `ciao` oder `avahi` (nutzt den avahi-Daemon der CCU über D-Bus). Ändere den Wert nur, wenn HomeKit die Bridge nicht findet. Ein unbekannter Wert fällt mit einer Warnung im Log auf `bonjour-hap` zurück.

## Architektur

homekit-ccu verbindet sich mit diesen Endpunkten der CCU:

| Port | Dienst | Endpunkt | Zweck |
|------|---------|----------|---------|
| 8183 (lokal) / 8181 (remote) | Rega | POST `/tclrega.exe` | Auflisten von Geräten/Variablen/Programmen per TCL-Skript |
| 2001 | BidCos-RF | XML-RPC | Klassische HomeMatic-Funkgeräte |
| 2010 | HmIP-RF | XML-RPC | HomeMatic-IP-Geräte |
| 9292 | VirtualDevices | XML-RPC | Virtuelle/gruppierte Geräte |
| 80/443 | JSON-RPC | POST `/api/homematic.cgi` | Authentifizierung, Sitzungsverwaltung |

Wichtige Quelldateien:
- `lib/HomeMaticCCU.js` — Verwaltung der CCU-Verbindung, Erkennung der Schnittstellen, Port-Zuordnung
- `lib/HomeMaticRPC.js` — Verarbeitung von XML-RPC/BinRPC-Events (Port 9875, nur Aufrufe von der CCU; auf der CCU lauscht er auf 127.0.0.1)
- `lib/HomeMaticRegaRequest.js` — HTTP-POST an Rega unter `:8183/tclrega.exe` (interner Port auf der CCU) oder `:8181/tclrega.exe` (Remote-Modus)
- `lib/configurationsrv/ConfigurationService.js` — Konfigurationsserver: Prüfung der JSON-RPC-Sitzung, Firewall-Ports, Datensicherung/Wiederherstellung, Live-Aktualisierung der Oberfläche per Long Polling (`lib/util/eventChannel.js`)
- `lib/services/camera/` — Streaming der Video-Türklingel (CameraController-Delegate, ffmpeg-Steuerung)
- `lib/Server.js` — HAP-Bridge-Server, Verwaltung der Instanzen (Ports 9877+)
- `index.js` — Einstiegspunkt

## OpenCCU-Kompatibilität

OpenCCU (früher RaspberryMatic ab v3.87) hat einige Änderungen eingeführt, die homekit-ccu betreffen:

1. **Nur noch 64 Bit** — Keine Unterstützung mehr für Pi0/Pi1/Pi2/armv7
2. **Proxy über lighttpd** — Die XML-RPC-Ports 2001/2010/9292 laufen jetzt über lighttpd; abgesicherte Varianten auf 42001/42010/49292
3. **Rega-Remote-Skripte** — Auf den Ports 80/443 gesperrt, funktionieren nur auf 8181/48181
4. **Port-Architektur** — Interne Daemons lauschen auf 32001 (rfd), 32010 (crRFD), 39292 (HMServer). lighttpd leitet die externen Ports weiter: `external = internal - 30000`. Rega `InterfaceUrl()` meldet die internen Ports; homekit-ccu ordnet sie automatisch um.
5. **Geänderte Authentifizierung** — Neue lighttpd-basierte Anmeldung gegen ReGaHss, optional Basic Auth für XML-RPC
6. **Patchen der WebUI-Übersetzungen** — Änderungen an `/webui/js/lang/<lang>/translate.lang.extension.js`
