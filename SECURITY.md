🇬🇧 English | [🇩🇪 Deutsch](#sicherheitsrichtlinie-deutsch)

# Security policy

## Supported versions

Only the latest release of HomeKit-CCU receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
[GitHub security advisories](https://github.com/bloop16/homekit-ccu/security/advisories/new).
Describe the problem, the affected version and how to reproduce it. You will get an answer
within a week.

## What HomeKit-CCU protects

- The configuration UI and its API require a CCU administrator session (see
  [doc/security.md](doc/security.md)).
- HomeKit setup codes and pairing keys are stored only in the add-on's configuration directory
  on the CCU and are never written to the log.
- Names coming from the CCU are shown as text in the configuration UI.
- The event servers only take calls from the CCU, restore uploads are checked before they are stored,
  and a configuration can only name service classes of HomeKit-CCU (see
  [doc/security.md](doc/security.md#further-protection)).

---

## Sicherheitsrichtlinie (Deutsch)

### Unterstützte Versionen

Nur das jeweils neueste Release von HomeKit-CCU erhält Sicherheitskorrekturen.

### Eine Sicherheitslücke melden

Bitte eröffne für Sicherheitsprobleme kein öffentliches Issue. Melde sie vertraulich über
[GitHub Security Advisories](https://github.com/bloop16/homekit-ccu/security/advisories/new).
Beschreibe das Problem, die betroffene Version und wie es sich nachstellen lässt. Du bekommst
innerhalb einer Woche eine Antwort.

### Was HomeKit-CCU schützt

- Die Konfigurationsoberfläche und ihre API verlangen eine CCU-Administrator-Sitzung (siehe
  [doc/de/security.md](doc/de/security.md)).
- HomeKit-Setup-Codes und Kopplungsschlüssel werden nur im Konfigurationsverzeichnis des Add-ons
  auf der CCU gespeichert und nie ins Log geschrieben.
- Namen, die von der CCU kommen, werden in der Konfigurationsoberfläche als Text angezeigt.
- Die Event-Server nehmen nur Aufrufe von der CCU an, hochgeladene Datensicherungen werden vor dem Speichern geprüft,
  und eine Konfiguration kann nur Service-Klassen von HomeKit-CCU angeben (siehe
  [doc/de/security.md](doc/de/security.md#weiterer-schutz)).
