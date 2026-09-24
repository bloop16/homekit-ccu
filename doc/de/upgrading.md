[🇬🇧 English](../upgrading.md) | 🇩🇪 Deutsch

# Umstieg von hap-homematic auf homekit-ccu

hap-homematic muss entfernt werden, bevor homekit-ccu installiert wird; der Installer verweigert die Installation, solange es noch da ist. Deine Konfiguration und die HomeKit-Kopplung kommen über eine Datensicherung mit:

1. **Sichere hap-homematic.** Öffne auf seiner Konfigurationsseite *Internes → Datensicherung* und erstelle eine Datensicherung. Bewahre die heruntergeladene `.tar.gz`-Datei auf. Eine CCU-Sicherung schadet auch nicht.
2. **Deinstalliere hap-homematic** unter *Einstellungen → Systemsteuerung → Zusatzsoftware*. Dabei wird auch sein Konfigurationsverzeichnis gelöscht, also erledige zuerst Schritt 1.
3. **Installiere homekit-ccu** wie in der [README](../../README.de.md#installation) beschrieben. Schließe den Einrichtungsassistenten, der sich beim ersten Aufruf öffnet; deine Geräte kommen mit der Datensicherung.
4. **Spiele die Datensicherung zurück** in homekit-ccu unter *Internes → Datensicherung*: Wähle die Datei aus Schritt 1 und klicke auf *Datensicherung zurückspielen*. homekit-ccu startet neu und holt deine Bridges, Geräte, Variablen, Programme und die HomeKit-Schlüssel zurück.

Entferne die Bridge nicht aus Apple Home. Mit den zurückgespielten Schlüsseln erkennt Apple Home sie wieder, und Räume, Szenen und Automationen bleiben erhalten. Hast du sie schon entfernt, füge sie mit dem Setup-Code, der unter *Instanzen bearbeiten* angezeigt wird, erneut hinzu.

Außerdem gut zu wissen:

- **Die Namen der Bridges ändern sich** von „HomeMatic default“ zu „HomeKit-CCU“ (Raum-Bridges „HomeKit-CCU <name>“). Namen, die du den Bridges und Geräten in Apple Home gegeben hast, bleiben.
- **Die Video-Türklingel muss neu hinzugefügt werden.** Sie bekommt jetzt eine eigene HomeKit-Identität (abgeleitet aus ihrer UUID statt der festen `00:00:11:22:22:11`), und die alte Standard-PIN `123-45-678` wird als zu einfach abgelehnt. Nutzt die Türklingel noch diese PIN, setze in ihren Einstellungen eine andere; sonst wird die Türklingel nicht veröffentlicht, und das Log sagt, warum. Entferne dann die alte Türklingel aus Apple Home und füge sie mit der neuen PIN wieder hinzu. Auch ein Umbenennen der Türklingel ändert ihre Identität.
- **Die Konfigurationsoberfläche verlangt eine CCU-Administrator-Sitzung**, auch auf der CCU selbst (0.0.x hat die Sitzung nur im Remote-Modus geprüft, und nur wenn eingeschaltet). Melde dich als Administrator an der CCU-WebUI an und öffne die Konfigurationsseite mit dem HomeKit-Button in der Systemsteuerung; ein Lesezeichen ohne Sitzungs-ID führt zu „Keine gültige CCU-Sitzung“. Das gilt für jede Änderung, Datensicherung und Wiederherstellung. Der Umstieg schaltet die Prüfung ein, auch wenn sie in der alten Konfiguration aus war (hap-homematic hat standardmäßig `"useCCCAuthentication": false` gespeichert); um sie wieder auszuschalten, entferne in den Einstellungen den Haken bei *CCU-Administrator-Anmeldung verlangen* (nicht empfohlen). Siehe [Anmeldung](security.md#anmeldung).
- **Neustart** in der Konfigurationsoberfläche ruft jetzt direkt `/etc/config/rc.d/homekit-ccu restart` auf (das alte npm-Skript gibt es nicht mehr). Im Remote-Modus gibt es kein rc.d-Skript; starte den Prozess selbst neu.
- **Reste eines deinstallierten hap-homematic werden bei der Installation entfernt**: seine monit-Konfiguration (`/usr/local/etc/monit_hap-homematic.cfg`, die jedes `monit reload` mit „Service name conflict“ scheitern ließ), seine lighttpd-Konfiguration und sein WebUI-Button.
