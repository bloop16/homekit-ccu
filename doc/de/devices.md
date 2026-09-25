[🇬🇧 English](../devices.md) | 🇩🇪 Deutsch

# Unterstützte Geräte

HomeKit-CCU zeigt HomeMatic-, HomematicIP- und HomeMatic-Wired-Geräte als die Gerätetypen, die Apple Home kennt: Ein Thermostat ist ein Thermostat, ein Rollladen eine Fensterabdeckung, eine Fernbedienung eine Reihe von Tasten. Wenn du ein Gerät in der Konfiguration hinzufügst, ist der passende Typ vorausgewählt. Du kannst pro Kanal einen anderen Typ wählen, zum Beispiel Schalter, Steckdose oder Licht für einen Schaltaktor.

Geräte, die du schon früher hinzugefügt hast, behalten ihren Typ, damit Räume, Szenen und Automationen in Apple Home so bleiben, wie sie sind.

Die Tabellen listen die Gerätefamilien mit typischen Modellen. Farbvarianten (`-A`, `-S`), Hardware-Revisionen (`-2`, `-3`), Ländervarianten (`-UK`, `-CH`, `-PE`, `-IT`, `-NL`), ELV (`ELV-SH-*`), Wired (`HmIPW-*`) und umgelabelte Modelle (Schüco `263 …`, Roto `ZEL STG RM …`) funktionieren wie das Modell, auf dem sie beruhen.

## Klima

| Geräte | In Apple Home | Hinweise |
|---|---|---|
| Heizkörperthermostate HmIP-eTRV (alle Varianten), Heizungsgruppen (HmIP-HEATING), HM-CC-RT-DN | Thermostat | Aus, Heizen und Auto; „Heizt“ folgt dem Ventil; Schritte von 0,5 °C; optionaler Boost-Schalter |
| Wandthermostate HmIP-WTH, WTH-2, WTH-B, STHD, BWTH, ALPHA-IP-RBG, HM-TC-IT-WM-W-EU | Thermostat + Luftfeuchtigkeitssensor | Durch den Luftfeuchtigkeitssensor erscheint die Luftfeuchte in der Raumübersicht |
| Temperatur-/Luftfeuchtesensoren HmIP-STH, STHO, ELV-SH-CTH, HM-WDS10/20/30/40 | Temperatur- und Luftfeuchtigkeitssensor | |
| Wetterstationen HmIP-SWO-B, SWO-PL, SWO-PR, HM-WDS100-C6-O, KS550 | Temperatur-, Luftfeuchtigkeits- und Lichtsensor | Wind, Regen und Luftdruck nur in der Eve-App, Apple Home hat dafür keine Kacheln |
| CO₂-Sensor HmIP-SCTH230 | Kohlendioxidsensor + Temperatur und Luftfeuchtigkeit | CO₂-Wert in ppm |
| CO₂-Ampel HM-CC-SCD | Kohlendioxidsensor + Luftqualität | |
| Feinstaubsensor HmIP-SFD | Luftqualitätssensor mit PM2,5 und PM10 + Temperatur und Luftfeuchtigkeit | |
| Fußbodenheizungsaktoren HmIP-FAL, FALMOT | Steuerung über den Wandthermostat oder die Heizungsgruppe des Raums | Der Aktor selbst zeigt nur Ventildaten in der Eve-App |

## Fenster, Türen und Beschattung

| Geräte | In Apple Home | Hinweise |
|---|---|---|
| Fenster-/Türkontakte HmIP-SWDO, SWDO-I, SWDO-PL, SWDM, SCI, FCI1, HM-Sec-SC, HM-Sec-SCo, HM-SCI-3-FM, HMW-Sen-SC-12 | Kontaktsensor | Gekippt zählt als offen; Sabotage und Batterie, sofern das Gerät sie meldet |
| Fenstergriffe HmIP-SRH, HM-Sec-RHS | Kontaktsensor | Optional als Fenster mit 0/50/100 % |
| Rollläden HmIP-BROLL, FROLL, HM-LC-Bl1 | Fensterabdeckung | Position, Bewegung und Stopp |
| Raffstores HmIP-BBL, FBL, DRBLI4, HM-LC-Ja1PBU-FM, Hunter Douglas HDM | Fensterabdeckung mit Lamellenneigung | |
| Fensterantrieb HmIP-MOD-WD-VK, WinMatic HM-Sec-Win | Fenster | Position, Bewegung und Stopp |
| Garagentormodule HmIP-MOD-HO, MOD-TM | Garagentoröffner + Licht | Öffnen/Schließen, angehalten; das Licht des Antriebs als Licht |
| Türschlossantrieb HmIP-DLD, Door Lock Drive Pro HmIP-DLP | Türschloss | Verriegelt, entriegelt, blockiert, unbekannt; optional Tür öffnen (Falle ziehen) |
| Türschlosssensor HmIP-DLS | Türschloss (nur lesend) | |
| KeyMatic HM-Sec-Key | Türschloss + optionaler Schalter „Öffnen“ | Blockiert bei Motor- oder Kupplungsfehlern |

## Sicherheit

| Geräte | In Apple Home | Hinweise |
|---|---|---|
| Rauchwarnmelder HmIP-SWSD, SWSD-2, SWSD-3, HM-Sec-SD, HM-Sec-SD-2 | Rauchmelder | Störung bei verschmutzter Rauchkammer, fehlgeschlagenem Test oder Verbindungsverlust |
| Wassermelder HmIP-SWD, HM-Sec-WDS | Lecksensor | |
| Regensensoren HmIP-SRD, HM-Sen-RD-O | Lecksensor | Regen zählt als „Leck“; Apple Home hat keinen Regensensor |
| Sirenen HmIP-ASIR, ASIR-2, ASIR-O | Schalter „Alarm“ | Apple Home hat keinen Sirenentyp. Einschalten löst die Sirene für die eingestellte Dauer aus (Standard 180 s) |
| CCU-Alarm (Scharfschalten über HM-Sec-Sir-WM, Variablen) | Alarmanlage | |

## Licht, Schalter und Energie

| Geräte | In Apple Home | Hinweise |
|---|---|---|
| Dimmer HmIP-BDT, FDT, PDT, DRDI3, WUA, HM-LC-Dim | Licht mit Helligkeit | |
| Farblichter HmIP-RGBW, LSC, E27, GU10 | Licht mit Farbe und Weißton | |
| RGBW-Controller HM-LC-RGBW-WM, Dual White HM-LC-DW-WM | Licht mit Farbe oder Weißton | |
| Zwischenstecker HmIP-PS, PS-2, PSM, HM-LC-Sw1-Pl, HM-ES-PMSw1-Pl | Steckdose | Leistung und Energie nur in der Eve-App |
| Schaltaktoren HmIP-BSM, FSM, FSI16, PCBS, DRSI1/4, MOD-OC8, HM-LC-Sw, HMW-IO | Schalter | Pro Kanal als Steckdose, Licht, Ventilator oder Ventil einstellbar |
| Bewässerungsventil HmIP-WSM | Ventil (Bewässerung) | Laufzeit in Apple Home einstellbar |
| Wasserstopp HmIP-WSS | Ventil | |
| Energiesensoren HmIP-ESI, HM-ES-TX-WM | Nur Eve-App | Apple Home zeigt keine Energiewerte |

## Taster und Sensoren

| Geräte | In Apple Home | Hinweise |
|---|---|---|
| Fernbedienungen und Wandtaster HmIP-WRC2, WRC6, BRC2, KRC4, KRCA, RC8, HM-RC, HM-PB | Ein Gerät mit nummerierten Tasten | Kurzer und langer Tastendruck für Automationen |
| Virtuelle CCU-Tasten HM-RCV-50 / HmIP-RCV-50 | Programmierbarer Schalter pro Taste | Oder ein Schalter, der die Taste drückt |
| Türklingel HmIP-DSD-PCB, HmIP-DBB, HM-Sen-DB-PCB | Programmierbarer Schalter | Startet Automationen; Apple Home zeigt eine Türklingel ohne Kamera als „Nicht unterstützt“ an |
| Bewegungsmelder HmIP-SMI, SMO, SMI55, HM-Sec-MDIR | Bewegungssensor + Lichtsensor | |
| Präsenzmelder HmIP-SPI | Präsenzsensor + Lichtsensor | |
| Lichtsensor HmIP-SLO, HM-Sen-LI-O | Lichtsensor | |
| Neigungs-/Erschütterungssensor HmIP-SAM, HM-Sec-TiS | Kontaktsensor | |

## CCU-Objekte

| Objekt | In Apple Home |
|---|---|
| Systemvariablen | Schalter, Sensor (Kontakt, Bewegung, Leck, Präsenz, Rauch), Zahlensensor oder Alarmanlage |
| Programme | Schalter, der das Programm startet |
| Besondere Geräte | Video-Türklingel (Kamera mit Gegensprechen), CCU-Temperatur (nicht in einer virtuellen Maschine), CCU Duty Cycle, Mehrfachtaster |

## Was Apple Home nicht anzeigen kann

Apple Home hat keine Kacheln für Leistung und Energie, Wind, Regenmenge, Luftdruck, Füllstand oder Sirenen. HomeKit-CCU sendet Leistungs-, Energie- und Wetterwerte als Eve-Characteristics, sodass die kostenlose Eve-App sie anzeigt. Apples Energiefunktionen (iOS 26) gibt es nur für Matter-Geräte.

Hier fehlt ein Gerät? Öffne ein [Issue](https://github.com/bloop16/homekit-ccu/issues/new?template=feature-request.md) mit der Gerätebeschreibung aus *Internes → Hilfe*.
