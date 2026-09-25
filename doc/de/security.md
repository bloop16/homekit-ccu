[🇬🇧 English](../security.md) | 🇩🇪 Deutsch

# Anmeldung und HTTPS

## Anmeldung

Die Konfigurationsoberfläche und ihre API (`/addons/homekit-ccu/api/` der CCU-WebUI, Port 9874 im Remote-Modus) sind für jedes Gerät in deinem Netzwerk erreichbar. Sie zeigen die HomeKit-Kopplungscodes, laden Datensicherungen mit den HomeKit-Schlüsseln herunter und können homekit-ccu ändern und neu starten. Deshalb braucht jeder API-Aufruf, die Datensicherung und Wiederherstellung sowie die Live-Aktualisierung (Long Polling über die API) eine gültige Sitzung eines CCU-Administrators:

- Melde dich als Administrator an der CCU-WebUI an und öffne die Konfiguration mit dem HomeKit-Button unter *Einstellungen → Systemsteuerung → Zusatzsoftware*. Die CCU übergibt ihre Sitzungs-ID (`?sid=@…@`) an die Seite, und die Seite schickt sie bei jeder Anfrage mit. Ein Lesezeichen oder eine eingetippte URL enthält keine Sitzungs-ID und zeigt „Keine gültige CCU-Sitzung“.
- homekit-ccu prüft die Sitzung gegen die CCU (ReGaHss-Sitzung eines Benutzers mit Administratorrechten) und verlängert sie bei Benutzung; eine geprüfte Sitzung wird 30 Sekunden lang gemerkt.
- Seiten anderer Hosts werden abgewiesen: Die API beantwortet Browser-Anfragen nur, wenn die Seite vom selben Hostnamen stammt (beliebiger Port oder beliebiges Schema), sodass keine andere Website deine CCU-Sitzung nutzen kann.

**Remote-Modus:** Die Sitzung wird gegen die mit `-H` angegebene CCU geprüft (ReGaHss auf Port 8181, JSON-RPC `/api/homematic.cgi` auf Port 80). Die Seite unter `http://<remote-host>:9874/` bekommt von selbst keine Sitzungs-ID, weil es den HomeKit-Button der CCU nur für das Add-on auf der CCU gibt. Melde dich an der CCU-WebUI an, kopiere die Sitzungs-ID aus der Adresszeile (den `@…@`-Wert von `sid=`) und öffne `http://<remote-host>:9874/index.html?sid=@…@`. Ohne CCU-Anmeldung funktioniert der Remote-Zugriff mit Anmeldeprüfung nicht.

Beim Umstieg von hap-homematic oder homekit-ccu 0.0.x wird die Prüfung eingeschaltet, auch wenn sie in der alten Konfiguration aus war (`config.json` bekommt `"configVersion": 2`, und nur ein danach gespeichertes `false` zählt). Um die Prüfung auszuschalten, entferne in den Einstellungen den Haken bei *CCU-Administrator-Anmeldung verlangen* oder setze `"useCCCAuthentication": false` in einer `config.json` mit `"configVersion": 2`. Das ist nicht empfehlenswert: Dann kann jeder in deinem Netzwerk die Kopplungscodes lesen, die HomeKit-Schlüssel herunterladen und die Konfiguration ändern.

## Weiterer Schutz

- Die Event-Server (9875, 9876) nehmen Aufrufe nur von der CCU und vom Rechner selbst an; auf der CCU lauschen sie auf 127.0.0.1. Niemand sonst im Netzwerk kann Gerätezustände an HomeKit senden.
- Ein Upload zur Wiederherstellung wird nur mit gültiger Sitzung gespeichert (als Header gesendet und vor dem Upload geprüft), und immer nur einer zur selben Zeit. Datensicherung und Wiederherstellung verwenden private temporäre Verzeichnisse, die danach gelöscht werden.
- Service-Klassen in der Konfiguration, auch aus einer zurückgespielten Datensicherung, müssen Klassen von homekit-ccu sein; die Video-Türklingel startet nur ein Programm namens `ffmpeg`.
- *ffmpeg installieren* lädt einen fest vorgegebenen Build des Homebridge-Projekts nur über https und installiert ihn nur, wenn seine SHA-256 zu der im Add-on passt; nichts anderes wird entpackt oder ausgeführt.
- Ein Bild-Upload für eine Türklingel braucht eine gültige Sitzung (vor dem Upload geprüft), höchstens 10 MB, und wird nur behalten, wenn er sich als PNG oder JPEG lesen lässt. Eine in den Einstellungen genannte Bilddatei muss auf .png, .jpg oder .jpeg enden; Bilder werden vor dem Zeichnen mit Größengrenzen dekodiert.
- Die UDP-Ports 9950–9979 für den Rückkanal des Livebilds werden in der CCU-Firewall nur geöffnet, solange es eine Video-Türklingel gibt.
- CCU-Sitzungs-IDs, HomeKit-Setup-Codes und Passwörter in URLs werden nicht ins Log geschrieben; die Log-Datei ist nur für root lesbar.
- Ist die Sitzungsprüfung ausgeschaltet, beantwortet die API nur Anfragen an die eigenen Adressen und Namen der CCU, sodass eine Webseite sie nicht erreichen kann, indem sie ihre eigene Domain auf die CCU zeigen lässt (DNS-Rebinding).

## HTTPS

Die Konfiguration und ihre API nutzen Adresse und Port der CCU-WebUI: lighttpd leitet `/addons/homekit-ccu/api/` an den Konfigurationsserver auf 127.0.0.1:39874 weiter. Über HTTPS geöffnet nutzen sie das Zertifikat der WebUI; es braucht keinen eigenen Port und keine zweite Zertifikats-Ausnahme (Firefox fragt pro Port).
