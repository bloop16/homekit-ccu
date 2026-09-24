[🇬🇧 English](../configuration.md) | 🇩🇪 Deutsch

# Konfiguration verwenden

Öffne die Konfiguration mit dem **HomeKit**-Button unter *Einstellungen → Systemsteuerung → Zusatzsoftware* in der CCU-WebUI (angemeldet als Administrator).

## Räume: warum eine Bridge pro Raum

HomeKit selbst kennt keine Räume. Eine Bridge kann Apple Home nicht mitteilen, in welchen Raum ein Gerät gehört, deshalb legt Apple Home ein **neues Gerät in den Raum seiner Bridge**. Steht deine Bridge im „Standardraum“, landet dort jedes neue Gerät.

- Weise der Bridge selbst in Apple Home einen Raum zu: Bridge antippen, dann *Einstellungen → Raum*. Neue Geräte dieser Bridge landen ab dann dort.
- Mit **einer Bridge pro CCU-Raum** landet jedes Gerät sofort in seinem Raum. Der Einrichtungsassistent erstellt diese Bridges für dich.
- Benennst du ein Gerät in HomeKit-CCU um, entsteht in Apple Home ein neues Gerät (seine Identität ergibt sich aus dem Namen, wie bei hap-homematic). Es landet wieder im Raum seiner Bridge.

## Einrichtungsassistent

Der erste Eintrag im Menü. Bei einer neuen Installation startet er von selbst.

1. **Aufteilung:** eine Bridge pro Raum (empfohlen), pro Etage oder eine für alles.
   - Optional kannst du Räume mit nur wenigen Geräten auf eine gemeinsame Bridge legen.
   - Optional kannst du Schlösser, Alarm und Sirenen auf eine eigene Bridge legen.
   - Hake die CCU-Gewerke an, deren Geräte du in Apple Home haben möchtest.
2. **Bridges und Räume:** Ändere die Namen der neuen Bridges und wähle für jeden Raum die Bridge oder „nicht übernehmen“. Bei Etagen kannst du weitere Etagen hinzufügen. Ein Raum, der schon eine Bridge hat, behält sie.
3. **Geräte:** Jedes Gerät und jeder Kanal lässt sich anhaken, benennen und auf den Typ setzen, den es in Apple Home haben soll (zum Beispiel Schalter, Steckdose oder Licht). Suche, Gerätebilder und der Schalter für Zusatzkanäle funktionieren wie bei „Neues Gerät hinzufügen“.
4. **Vorschau:** Bridges mit ihren Räumen, Geräten und Apple-Geräten. Apple Home nimmt höchstens 149 Geräte pro Bridge an; der Assistent warnt vorher.
5. **Koppeln:** Die neuen Bridges starten ohne Geräte. Füge jede in Apple Home hinzu (+, *Gerät hinzufügen*, Code scannen) und wähle den angezeigten Raum. Der Status wechselt von selbst auf „gekoppelt“. Danach *Geräte veröffentlichen*: Die Geräte landen im Raum ihrer Bridge.

Geräte, die schon in HomeKit sind, werden nie auf eine andere Bridge verschoben; sonst verlöre Apple Home ihren Raum, ihre Szenen und Automationen.

## Neues Gerät

*Geräte → Neu* listet deine CCU-Geräte auf, nicht einzelne Kanäle:

- Suche über Gerät, Kanal, Raum und Seriennummer; Filter für Raum, Gewerk, Geräteart und Funksystem.
- Jedes Gerät zeigt sein Bild aus der CCU-WebUI.
- Geräte, die schon in HomeKit sind, der zweite und dritte virtuelle Kanal von HomematicIP-Ausgängen und die virtuellen CCU-Tasten (HM-RCV-50, HmIP-RCV-50) sind ausgeblendet, bis du sie einschaltest.
- Hakst du ein Gerät an, werden seine sinnvollen Kanäle ausgewählt. Die Tasten einer Fernbedienung stehen in einer Zeile: ein Gerät mit je einem Button pro Taste oder ein eigenes Gerät pro Taste.
- Im zweiten Schritt legst du Name, Typ in Apple Home und Bridge für alle gewählten Kanäle auf einmal fest. Weitere Einstellungen findest du in der Geräteliste unter *Bearbeiten*.

**Mehrere Schaltausgänge als ein Gerät:** Bei einem Gerät mit zwei oder mehr Schaltausgängen (zum Beispiel HmIP-DRSI4, HmIP-BS2, HMW-IO-12) bietet der zweite Schritt „Ein Gerät in Apple Home mit N Schaltern“ an. Alle Schalter teilen sich dann einen Raum; Apple Home kann sie trotzdem als getrennte Kacheln zeigen. Getrennte Geräte können je einen eigenen Raum haben. Diese Option ist standardmäßig aus.

## Besondere Geräte

*Besondere Geräte → Neu* fragt zuerst nach der Art: Video-Türklingel, Garagentor aus Sensoren und Aktoren, Fenster aus Drehgriff und Kontakt, mehrere Tasten als ein Gerät, HTTP-Schalter, CCU-Temperatur oder CCU Duty Cycle. Das Formular zeigt dann nur die Einstellungen dieser Art; selten gebrauchte (ffmpeg, Videogröße, Verzögerungen der Aktoren) findest du unter *Erweiterte Einstellungen zeigen*. Der Name eines besonderen Geräts muss eindeutig sein.

## Türklingel-Tasten

Apple Home zeigt eine Türklingel ohne Kamera als „Nicht unterstützt“ an. HmIP-DSD-PCB, HmIP-DBB und HM-Sen-DB-PCB werden deshalb als programmierbarer Schalter hinzugefügt: Ein Klingeln kann Automationen starten. Für eine Klingel-Mitteilung mit Bild nutze die Video-Türklingel (besonderes Gerät).
