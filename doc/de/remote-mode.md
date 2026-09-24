[🇬🇧 English](../remote-mode.md) | 🇩🇪 Deutsch

# Betriebsarten

homekit-ccu kann in zwei Betriebsarten laufen: **lokal** (als CCU-Add-on) oder **remote** (auf einem separaten Rechner, der sich über das Netzwerk mit der CCU verbindet).

## Lokaler Modus (CCU-Add-on)

Das ist die Standard- und empfohlene Betriebsart. homekit-ccu läuft als Add-on direkt auf der CCU und spricht alle Dienste über localhost auf den internen Ports an.

```bash
node index.js -D
```

## Remote-Modus

Du kannst homekit-ccu auf einem separaten Rechner betreiben (z. B. einem Raspberry Pi, NAS oder Desktop-PC) und auf deine CCU zeigen lassen. Mit dem Parameter `-H` gibst du die Adresse der CCU an. Ist auf deiner CCU Basic Auth für XML-RPC aktiv (auf OpenCCU üblich), übergib die Zugangsdaten mit `-U` und `-P`.

```bash
node index.js -D -H 192.168.1.100
node index.js -D -H 192.168.1.100 -U rpcuser -P rpcpassword
```

Im Remote-Modus ordnet homekit-ccu die internen Daemon-Ports (32001, 32010, 39292) automatisch den externen, von lighttpd weitergeleiteten Ports (2001, 2010, 9292) zu.

| CLI-Parameter | Beschreibung |
|----------|-------------|
| `-D` | Debug-Logging einschalten |
| `-H <host>` | IP-Adresse der CCU (Standard: localhost) |
| `-U <user>` | Benutzername für XML-RPC Basic Auth (Remote-Modus) |
| `-P <password>` | Passwort für XML-RPC Basic Auth (Remote-Modus) |
| `-C <path>` | Konfigurationspfad |
| `-L <dir>` | Verzeichnis für `homekit-ccu.log` (Standard `/var/log`; das Temp-Verzeichnis, wenn keines von beiden beschreibbar ist) |
| `-S <file>` | Simulation mit einer Gerätedatei |
| `-R` | Probelauf — nur zwischengespeicherte Dateien verwenden |

## Ports

* 9874 -> Konfigurations-WebUI im Remote-Modus (der Konfigurationsserver lauscht dort selbst). Auf der CCU nutzt die Konfiguration den Port der WebUI: lighttpd leitet `/addons/homekit-ccu/api/` an den Konfigurationsserver auf 127.0.0.1:39874 weiter.
* 9875 -> RPC-Event-Server (nimmt nur Aufrufe von der CCU an; auf der CCU selbst lauscht er auf 127.0.0.1)
* 9876 -> RPC-Event-Server CuxD (optional, gleiche Regel)
* 9877..n HAP-Instanz 0 .. n
* 5353/udp -> mDNS (Bonjour), damit HomeKit die Bridges findet
* zufällige UDP-Ports -> Streams der Video-Türklingel (siehe [Video-Türklingel](video-doorbell.md))

Die Installation öffnet für die Konfiguration keinen Port in der CCU-Firewall und schließt 9874/49874, die ältere Versionen geöffnet haben; die Ports der Bridges öffnet HomeKit-CCU selbst.
