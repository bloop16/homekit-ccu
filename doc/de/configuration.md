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
2. **Bridges und Räume:** Benenne die neuen Bridges um, entferne vorgeschlagene oder füge eigene hinzu (bei Etagen: weitere Etagen). Wähle dann für jeden Raum die Bridge oder „nicht übernehmen“. Jede Bridge braucht einen eigenen Namen. Ein Raum, der schon eine Bridge hat, behält sie.
3. **Geräte:** Jedes Gerät und jeder Kanal lässt sich anhaken, benennen und auf den Typ setzen, den es in Apple Home haben soll (zum Beispiel Schalter, Steckdose oder Licht). Jedes Gerät hat ein Feld *Bridge*: Es startet mit der Bridge seines Raums und lässt sich ändern; das Gerät wandert dann in den Abschnitt dieser Bridge („abweichend vom Raum“). Geräte auf „nicht übernehmen“ stehen am Ende und lassen sich zurückholen. Suche, Gerätebilder und der Schalter für Zusatzkanäle funktionieren wie bei „Neues Gerät hinzufügen“.
4. **Vorschau:** Bridges mit ihren Räumen, Geräten und Apple-Geräten. Apple Home nimmt höchstens 149 Geräte pro Bridge an; der Assistent warnt vorher.
5. **Koppeln:** Die neuen Bridges starten ohne Geräte. Füge jede in Apple Home hinzu (+, *Gerät hinzufügen*, Code scannen) und wähle den angezeigten Raum. Der Status wechselt von selbst auf „gekoppelt“. Danach *Geräte veröffentlichen*: Die Geräte landen im Raum ihrer Bridge.
   - **Lege die Räume zuerst in Apple Home an** (+, *Raum hinzufügen*). Beim Hinzufügen einer Bridge bietet Apple Home nur vorhandene Räume und eigene Vorschläge an, ein neuer Name lässt sich dort nicht eingeben. Das liegt an Apple Home, nicht an der Bridge: HomeKit sieht nicht vor, dass eine Bridge einen Raum benennt.
   - Beim Speichern der Konfiguration starten nur Bridges neu, deren Name, Setup-Code oder HomeKit-Kennung sich geändert hat, und eine Bridge, deren Kopplung zurückgesetzt wird. Die anderen laufen weiter, eine laufende Kopplung wird nicht unterbrochen.

Geräte, die schon in HomeKit sind, werden nie auf eine andere Bridge verschoben; sonst verlöre Apple Home ihren Raum, ihre Szenen und Automationen.

## Neues Gerät

*Geräte → Neu* listet deine CCU-Geräte auf, nicht einzelne Kanäle:

- Suche über Gerät, Kanal, Raum und Seriennummer; Filter für Raum, Gewerk, Geräteart und Funksystem.
- Jedes Gerät zeigt sein Bild aus der CCU-WebUI.
- Geräte, die schon in HomeKit sind, der zweite und dritte virtuelle Kanal von HomematicIP-Ausgängen und die virtuellen CCU-Tasten (HM-RCV-50, HmIP-RCV-50) sind ausgeblendet, bis du sie einschaltest.
- Hakst du ein Gerät an, werden seine sinnvollen Kanäle ausgewählt. Die Tasten einer Fernbedienung stehen in einer Zeile: ein Gerät mit je einem Button pro Taste oder ein eigenes Gerät pro Taste.
- Im zweiten Schritt legst du Name, Typ in Apple Home und Bridge für alle gewählten Kanäle auf einmal fest. Weitere Einstellungen findest du in der Geräteliste unter *Bearbeiten*.

**Mehrere Schaltausgänge als ein Gerät:** Bei einem Gerät mit zwei oder mehr Schaltausgängen (zum Beispiel HmIP-DRSI4, HmIP-BS2, HMW-IO-12) bietet der zweite Schritt „Ein Gerät in Apple Home mit N Schaltern“ an. Alle Schalter teilen sich dann einen Raum; Apple Home kann sie trotzdem als getrennte Kacheln zeigen. Getrennte Geräte können je einen eigenen Raum haben. Diese Option ist standardmäßig aus.

## CCU-Gruppen

Gruppen der CCU (*Einstellungen → Gruppen*, Geräte mit der Adresse `INT…`, z. B. HmIP-Heizungsgruppen) stehen im Einrichtungsassistenten und bei „Neues Gerät hinzufügen“ über ihren Mitgliedsgeräten. Die Gruppe steuert ihre Mitglieder: Hakst du die Gruppe an, wird abgewählt, was sie dort übernimmt (z. B. das Thermostat eines Heizkörpers in einer Heizungsgruppe). Andere Funktionen eines Mitglieds, etwa ein Fensterkontakt, bleiben, wie sie sind. Alles lässt sich weiterhin von Hand anhaken. Die Gruppe bekommt ihre Bridge wie jedes andere Gerät.

HomeKit-CCU liest die Mitglieder aus der Gruppenverwaltung der CCU (`groups.gson`). Im Remote-Modus steht diese Datei nicht zur Verfügung; Gruppen erscheinen dann ohne ihre Mitglieder.

## Besondere Geräte

*Besondere Geräte → Neu* fragt zuerst nach der Art: Türklingel, Video-Türklingel, Garagentor aus Sensoren und Aktoren, Fenster aus Drehgriff und Kontakt, mehrere Tasten als ein Gerät, CCU-Temperatur oder CCU Duty Cycle. CCU-Temperatur wird nur angeboten, wenn das System eine hat: Eine virtuelle Maschine (OVA, Proxmox) hat keine, auch die Systemseite der CCU zeigt dort „n/a“. Der Duty Cycle ist der des Funkmoduls, von BidCos-RF und HmIP-RF wie auf der Systemseite der CCU. Das Formular zeigt dann nur die Einstellungen dieser Art; selten gebrauchte (ffmpeg, Videogröße, Verzögerungen der Aktoren) findest du unter *Erweiterte Einstellungen zeigen*. Der Name eines besonderen Geräts muss eindeutig sein.

## Türklingeln

Apple Home zeigt eine Türklingel nur als Teil einer Kamera an; eine Klingel allein ist „Nicht unterstützt“. Eine Türklingel von HomeKit-CCU hat deshalb eine Kamera, die ein Standbild zeigt: Apple Home führt sie unter *Kameras und Türklingeln*, meldet ein Klingeln mit dem Bild und spielt den Gong auf einem HomePod. Tippst du die Kachel an, gibt es kein Livebild, weil es keines gibt.

- **HmIP-DSD-PCB, HmIP-DBB, HM-Sen-DB-PCB** werden als Türklingel hinzugefügt; die andere Wahl ist ein programmierbarer Schalter für Automationen. Der HmIP-DSD-PCB klingelt bei einem Tastendruck (Werkseinstellung „Taster“); ist sein Kanal in der CCU auf Schalter- oder Kontaktbetrieb gestellt, klingelt er, wenn die Klingelspannung anliegt.
- **Jeder andere Taster oder Kontakt** wird mit *Besondere Geräte → Neu → Türklingel* zur Klingel: Wähle den Datenpunkt, der klingelt, einen Tastendruck (`PRESS_SHORT`) oder einen Zustand (`STATE`), der aktiv wird.
- **Bild:** das Bild des Geräts in der CCU; stattdessen eine URL (zum Beispiel das Standbild einer Kamera) oder eine PNG-/JPEG-Datei auf der CCU. *Bild hochladen* neben dem Feld speichert ein PNG oder JPEG (höchstens 10 MB) mit der Konfiguration, so dass es im Backup ist, und wählt es aus. Lässt es sich nicht laden, erscheint das Bild des Geräts, sonst ein einfarbiges Bild.
- **Ein Kamerabild, das ersetzt wird** (eine URL oder Datei mit dem Standbild, das eine Kamera ablegt, z. B. ein n8n-Webhook, der das letzte Standbild liefert): *Bild erneut lesen nach* (Standard 10 Sekunden) liest es erneut, wenn Apple Home das Bild anfragt, höchstens so oft und im Hintergrund; ein geändertes Bild erscheint ab dann. Gelesen wird nur, was abgelegt ist, keine Kamera wird geweckt. Eine URL darf Benutzer und Passwort enthalten (`https://benutzer:passwort@host/…`, Basic Auth). Kamerabilder füllen die Kachel; 0 liest das Bild einmal.
- Klingeln im Abstand unter 3 Sekunden zählt einmal.
- Mit einer Kamera an der Tür nutze die Video-Türklingel (besonderes Gerät), sie braucht ffmpeg.
