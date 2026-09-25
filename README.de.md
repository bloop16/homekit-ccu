<p align="center">
  <img src="doc/logo.png" width="96" alt="HomeKit-CCU-Logo">
</p>

<p align="center"><a href="README.md">🇬🇧 English</a> | 🇩🇪 Deutsch</p>

<h1 align="center">HomeKit-CCU</h1>

<p align="center">
  Deine HomeMatic- und HomematicIP-Geräte in Apple Home.<br>
  Läuft direkt auf deiner OpenCCU. Ohne Homebridge, ohne zusätzliche Hardware.
</p>

<p align="center">
  <a href="https://github.com/bloop16/homekit-ccu/releases/latest"><img src="https://img.shields.io/github/v/release/bloop16/homekit-ccu?include_prereleases&label=release" alt="Release"></a>
  <a href="https://github.com/bloop16/homekit-ccu/actions/workflows/ci.yml"><img src="https://github.com/bloop16/homekit-ccu/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/OpenCCU-3.89%2B-2c7be5" alt="OpenCCU 3.89+">
  <img src="https://img.shields.io/badge/Node.js-22-339933" alt="Node.js 22">
</p>

> [!IMPORTANT]
> **Benötigt OpenCCU 3.89 oder neuer** (bringt Node.js 22 mit). CCU3-Hardware funktioniert, wenn darauf OpenCCU läuft.
> Nicht unterstützt: CCU2, CCU3 mit der eQ-3-Firmware sowie ältere OpenCCU- oder RaspberryMatic-Versionen. Ist Node.js zu alt, bricht der Installer mit einer klaren Meldung ab.

<p align="center">
  <img src="doc/screenshot.png" width="720" alt="HomeKit-CCU-Konfiguration">
</p>

## Was du bekommst

- Deine HomeMatic- und HomematicIP-Geräte in der Home-App: dort steuern, in Szenen und Automationen nutzen und per Siri bedienen.
- Einen Einrichtungsassistenten, der die Räume deiner CCU übernimmt, damit jedes Gerät im richtigen Raum landet.
- Geräteauswahl aus einer Liste mit Bildern, Suche und Filtern.
- Türklingeln, die Apple Home als Türklingel zeigt: eine Mitteilung mit Bild beim Klingeln und den Gong auf deinem HomePod. Mit einer Kamera zeigt die Video-Türklingel dazu Livebild und Ton.
- Verlauf und zusätzliche Werte deiner Sensoren in der Eve-App.
- Konfiguration direkt in der CCU, geschützt durch deine CCU-Anmeldung.

## Unterstützte Geräte

HomematicIP-, HomeMatic- und HomeMatic-Wired-Geräte erscheinen als die Gerätetypen, die Apple Home kennt:

- **Klima:** Heizkörper- und Wandthermostate, Heizungsgruppen, Temperatur-, Luftfeuchte-, CO₂- und Feinstaubsensoren, Wetterstationen
- **Fenster und Türen:** Kontakte, Fenstergriffe, Rollläden und Raffstores mit Lamellenverstellung, Fensterantriebe, Garagentore, Türschlösser (DLD, DLP, KeyMatic)
- **Sicherheit:** Rauch-, Wasser- und Regenmelder, Sirenen, der CCU-Alarm als Alarmanlage
- **Licht und Strom:** Dimmer, Farblichter, Schalter, Steckdosen, Bewässerungs- und Wasserventile
- **Taster und Sensoren:** Fernbedienungen als ein Gerät mit nummerierten Tasten, Türklingeln, Bewegungs-, Präsenz- und Lichtsensoren
- **CCU:** Systemvariablen, Programme, der Duty Cycle der CCU, eine Video-Türklingel für eine Kamera (RTSP) und eine Türklingel an jedem Taster oder Kontakt

Die [Geräteliste](doc/de/devices.md) zeigt jede Gerätefamilie mit ihren Modellen und wie sie in Apple Home aussieht.

## Installation

1. Lade `homekit-ccu-x.y.z.tar.gz` aus dem [neuesten Release](https://github.com/bloop16/homekit-ccu/releases/latest) herunter.
2. Öffne auf der CCU *Einstellungen → Systemsteuerung → Zusatzsoftware*, wähle die Datei aus und installiere sie.
3. Nach ein bis zwei Minuten erscheint in der Systemsteuerung ein **HomeKit**-Button. Öffne ihn: Der Einrichtungsassistent schlägt Bridges und Geräte aus deinen CCU-Räumen vor und zeigt für jede Bridge den QR-Code, mit dem du sie in der Home-App hinzufügst. Siehe [Konfiguration verwenden](doc/de/configuration.md).

Für die Installation braucht die CCU keinen Internetzugang. Fortschritt und Fehler landen in `/var/log/homekit-ccu.log`.

## Umstieg von hap-homematic?

hap-homematic muss zuerst weg, deine Einrichtung kommt mit dessen Datensicherung mit:

1. Erstelle in hap-homematic eine Datensicherung unter *Internes → Datensicherung*.
2. Deinstalliere hap-homematic.
3. Installiere homekit-ccu und spiele die Datensicherung unter *Internes → Datensicherung* zurück.

Bridges, Geräte und die HomeKit-Kopplung kommen zurück, Räume und Automationen bleiben in Apple Home erhalten. Details stehen in den [Hinweisen zum Umstieg](doc/de/upgrading.md).

## Dokumentation

| Thema | |
|---|---|
| Einrichtungsassistent, neue Geräte, besondere Geräte, Räume | [doc/de/configuration.md](doc/de/configuration.md) |
| Umstieg von hap-homematic | [doc/de/upgrading.md](doc/de/upgrading.md) |
| Anmeldung, HTTPS und warum die Oberfläche eine CCU-Sitzung braucht | [doc/de/security.md](doc/de/security.md) |
| Türklingeln, Video-Türklingel und ffmpeg | [doc/de/video-doorbell.md](doc/de/video-doorbell.md) |
| Betrieb auf einem anderen Rechner, Ports | [doc/de/remote-mode.md](doc/de/remote-mode.md) |
| Unterstützte Geräte und wie sie in Apple Home aussehen | [doc/de/devices.md](doc/de/devices.md) |
| Räume, Eve-Verlauf, mDNS, Architektur | [doc/de/advanced.md](doc/de/advanced.md) |
| Entwicklung und Fehlersuche | [doc/de/development.md](doc/de/development.md) |
| Was sich geändert hat | [CHANGELOG.md](CHANGELOG.md) |

## Hilfe

Etwas funktioniert nicht oder ein Gerät fehlt? Öffne ein [Issue](https://github.com/bloop16/homekit-ccu/issues/new) und hänge den passenden Ausschnitt aus `/var/log/homekit-ccu.log` an.

## Danksagung

homekit-ccu führt [hap-homematic](https://github.com/thkl/hap-homematic) von Thomas Kluge ([@thkl](https://github.com/thkl)) und die OpenCCU-Portierung von Jochen Britz ([Britz/homekit-ccu](https://github.com/Britz/homekit-ccu)) fort. Das Icon hat @roe1974 gestaltet. Lizenziert unter der [MIT-Lizenz](LICENSE).
