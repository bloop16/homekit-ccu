# homekit-ccu Kern-Upgrade – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** homekit-ccu von `hap-nodejs` 0.11.1 auf `@homebridge/hap-nodejs` 2.2.3 heben, veraltete Dependencies ersetzen, die Video-Klingel auf `CameraController` mit Audio und Zwei-Wege-Audio umschreiben und ein reproduzierbares GitHub-Release als OpenCCU-Addon (Node 22) liefern.

**Architecture:** Der Bridge-Kern (`lib/Server.js`, `lib/HomeMaticCCU.js`, `lib/services/HomeMatic*Accessory.js`) bleibt strukturell unverändert; nur die HAP-API-Aufrufe werden angepasst. Die Kamera wird als eigenes Modul `lib/services/camera/` mit vier kleinen Dateien gebaut (reiner Argument-Builder, Prozess-Wrapper, UDP-Port-Helfer, Streaming-Delegate), so dass alles außer dem echten ffmpeg-Aufruf mit einem Fake-ffmpeg testbar ist. CI und Release laufen über GitHub Actions; das Addon-Tarball wird nicht mehr eingecheckt.

**Tech Stack:** Node.js 22, CommonJS, `@homebridge/hap-nodejs` 2.2.3, mocha 11 + expect.js, standard (Lint), c8 (Coverage), GitHub Actions, ffmpeg (extern, vom Nutzer bereitgestellt).

**Spec:** `docs/superpowers/specs/2026-09-23-core-upgrade-design.md`

**Erkenntnisse aus Stufe 2 (für spätere Tasks):** In 2.x fehlen zusätzlich `Characteristic.getValue(cb)` (Tests nutzen `test/helpers/characteristicValue.js`), `Service.BatteryService` (jetzt `Service.Battery`), `Accessory.setPrimaryService()` (jetzt `service.setPrimaryService()`) und `Accessory.updateReachability()`. `new Characteristic(name, uuid, props)` setzt keinen Default-Wert; `CustomHomeKitTypes` setzt ihn selbst. 2.x loggt `characteristic value expected valid finite number and received "NaN"` für einige Blind-, Window-, ClosedDuration- und Humidity-Characteristics; das ist ein vorbestehender Datenfehler (NaN-Werte vor der ersten Abfrage) und ein Kandidat für ein Folgeprojekt, nicht Teil dieser Iteration.

**Arbeitsweise:** Jede Task auf einem eigenen Branch `feat/<task>` von `master`, Commits im Format `<type>: <description>` mit Zeile `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Nach jeder Task `npm test` grün. Repo: `/home/martin/homekit-ccu`. Commits mit `git -c user.name="Martin Rauscher" -c user.email="martin.rauscher@amring.xyz"` ausführen, falls kein globaler Git-User gesetzt ist.

---

## Dateiübersicht

| Datei | Aktion | Verantwortung |
|---|---|---|
| `.github/workflows/ci.yml` | neu | Tests (und ab Task 8 Lint) bei Push/PR |
| `.github/workflows/release.yml` | neu | Tarball bauen und Release anhängen bei Tag `v*` |
| `.github/workflows/nodejs.yml`, `.travis.yml`, `addon_installer/homekit-ccu-0.0.16.tar.gz` | löschen | Altlasten |
| `package.json`, `package-lock.json` | ändern / neu eingecheckt | Dependencies, Scripts, engines |
| `lib/services/CustomHomeKitTypes.js` | umschreiben | Custom-Characteristics/-Services als ES-Klassen |
| `lib/Server.js` | ändern | HAP-Import, `Categories`, `gatoHomeBridge.hap`, Advertiser, Manufacturer |
| `lib/services/*.js`, `lib/BridgeMock.js`, `test/*.js` | mechanisch ändern | Paketname, `Formats/Perms/Units`, `Perms.READ/WRITE` |
| `index.js` | umschreiben (CLI-Teil) | commander 14 mit `opts()` |
| `lib/configurationsrv/index.js` | ändern (`processRestore`) | formidable 3 |
| `lib/util/time.js` | neu | `nowUnix()` als moment-Ersatz |
| `lib/services/camera/ffmpegArgs.js` | neu | Reine Funktionen für ffmpeg-Argumente und SDP |
| `lib/services/camera/FfmpegProcess.js` | neu | Spawn, Timeout, Kill, Encoder-Probe, Snapshot-Sammler |
| `lib/services/camera/udpPort.js` | neu | Freien UDP-Port reservieren |
| `lib/services/camera/streamingOptions.js` | neu | `CameraStreamingOptions` aus Encoder-Set bauen |
| `lib/services/camera/StreamingDelegate.js` | neu | `CameraStreamingDelegate`-Implementierung |
| `lib/services/HomeMaticSPVideoDoorBellAccessory.js` | umschreiben | Doorbell-Accessory mit `CameraController` |
| `lib/services/ffmpeg.js` | löschen | Alte StreamController-Implementierung |
| `lib/configurationsrv/localization/de.json` | ergänzen | Labels/Hints der neuen Kamera-Einstellungen |
| `test/fixtures/fake-ffmpeg.sh` | neu | Fake-ffmpeg für Tests |
| `test/100_custom_types.js`, `test/101_time_util.js`, `test/102_ffmpeg_args.js`, `test/103_ffmpeg_process.js`, `test/104_streaming_delegate.js`, `test/105_streaming_options.js` | neu | Tests |
| `addon_installer/homekit-ccu` | ändern | Node-22-Check, dynamische Node-Version |
| `README.md`, `CHANGELOG.md` | ändern | Installation, ffmpeg, Advertiser, 0.1.0 |

---

## Stufe 1: Pipeline

### Task 1: Altlasten entfernen, Lockfile einchecken, CI-Workflow

**Files:**
- Delete: `.travis.yml`, `.github/workflows/nodejs.yml`, `addon_installer/homekit-ccu-0.0.16.tar.gz`
- Modify: `.gitignore`, `package.json`, `README.md:3-5`
- Create: `.github/workflows/ci.yml`, `package-lock.json`

- [ ] **Step 1: Branch anlegen und Altlasten löschen**

```bash
cd /home/martin/homekit-ccu
git checkout -b feat/pipeline master
git rm -q .travis.yml .github/workflows/nodejs.yml addon_installer/homekit-ccu-0.0.16.tar.gz
```

- [ ] **Step 2: `.gitignore` anpassen**

Die Zeilen `package-lock.json` und `!addon_installer/homekit-ccu-*.tar.gz` entfernen:

```bash
sed -i '/^package-lock.json$/d; /^!addon_installer\/homekit-ccu-\*\.tar\.gz$/d' .gitignore
grep -n "package-lock\|tar.gz" .gitignore || echo "clean"
```

Erwartet: `clean`

- [ ] **Step 3: `package.json` Version und engines setzen**

In `package.json` ändern:

```json
"version": "0.1.0-dev",
"engines": {
  "node": ">=22.0.0"
},
```

- [ ] **Step 4: Lockfile erzeugen und Tests laufen lassen**

```bash
rm -rf node_modules
npm install --no-audit --no-fund
npm test 2>&1 | tail -3
```

Erwartet: `339 passing`

- [ ] **Step 5: CI-Workflow schreiben**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
```

- [ ] **Step 6: README-Badges ersetzen**

In `README.md` die Zeilen 3 bis 5 (Travis-, npm- und alter Node.js-CI-Badge) ersetzen durch:

```markdown
[![CI](https://github.com/bloop16/homekit-ccu/actions/workflows/ci.yml/badge.svg)](https://github.com/bloop16/homekit-ccu/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/bloop16/homekit-ccu?include_prereleases)](https://github.com/bloop16/homekit-ccu/releases/latest)
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: replace travis/legacy CI with GitHub Actions, drop bundled tarball

- remove .travis.yml and nodejs.yml, add ci.yml on Node 22
- stop tracking addon tarball, commit package-lock.json
- version 0.1.0-dev, engines node >=22

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: Release-Workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `addon_installer/genscript.sh:26-31`

- [ ] **Step 1: Tippfehler in genscript beheben**

In `addon_installer/genscript.sh` steht `if [ -e "$TTARFILE" ]` (doppeltes T). Ersetzen durch:

```bash
if [ -e "$TARFILE" ]; then
    rm -f "$TARFILE"
fi
```

- [ ] **Step 2: Lokalen Build prüfen**

```bash
cd /home/martin/homekit-ccu/addon_installer && sh genscript.sh 2>&1 | tail -2 && tar tzf homekit-ccu-0.1.0-dev.tar.gz && rm homekit-ccu-0.1.0-dev.tar.gz && cd ..
```

Erwartet: `Done: homekit-ccu-0.1.0-dev.tar.gz` und die drei Einträge `homekit-ccu`, `homekit-ccu.tgz`, `update_script`.

- [ ] **Step 3: Release-Workflow schreiben**

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - name: Check tag matches package version
        run: |
          PKG=$(node -p "require('./package.json').version")
          TAG=${GITHUB_REF_NAME#v}
          if [ "$PKG" != "$TAG" ]; then
            echo "package.json version $PKG does not match tag $TAG" >&2
            exit 1
          fi
      - name: Build addon tarball
        run: cd addon_installer && sh genscript.sh
      - name: Publish release
        uses: softprops/action-gh-release@v2
        with:
          files: addon_installer/homekit-ccu-*.tar.gz
          generate_release_notes: true
          prerelease: ${{ contains(github.ref_name, '-') }}
```

- [ ] **Step 4: Commit, Merge nach master, Push**

```bash
git add -A
git commit -m "ci: add release workflow building the addon tarball on v* tags

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git checkout master && git merge --ff-only feat/pipeline && git push -u origin master
```

- [ ] **Step 5: CI-Lauf prüfen**

```bash
sleep 60; gh run list -R bloop16/homekit-ccu --limit 2
```

Erwartet: Workflow `CI` mit Status `completed success`.

---

## Stufe 2: HAP-Migration

### Task 3: Custom-Types als ES-Klassen, Paketwechsel, Enum-Umstellung

**Files:**
- Modify: `package.json`, `lib/services/CustomHomeKitTypes.js`, `lib/Server.js`, `lib/BridgeMock.js`, `lib/services/*.js`, `test/*.js`
- Create: `test/100_custom_types.js`

- [ ] **Step 1: Branch anlegen**

```bash
cd /home/martin/homekit-ccu && git checkout -b feat/hap2 master
```

- [ ] **Step 2: Fehlschlagenden Test für die Klassen-Factory schreiben**

`test/100_custom_types.js`:

```js
const path = require('path')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const CustomHomeKitTypes = require(path.join(__dirname, '..', 'lib', 'services', 'CustomHomeKitTypes.js'))

const CHAR_UUID = 'E863F118-079E-48FF-8F27-9C2605A29F52'
const SERVICE_UUID = 'E863F00A-079E-48FF-8F27-9C2605A29F52'

describe('HomeKit-CCU CustomHomeKitTypes', () => {
  let types

  beforeEach(() => {
    types = new CustomHomeKitTypes(hap)
    types.createCharacteristic('TestDuration', CHAR_UUID, {
      format: hap.Formats.UINT32,
      unit: hap.Units.SECONDS,
      perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY, hap.Perms.PAIRED_WRITE]
    })
  })

  it('creates a characteristic class that extends hap.Characteristic', () => {
    const c = new types.Characteristic.TestDuration()
    expect(c).to.be.a(hap.Characteristic)
    expect(c.UUID).to.be(CHAR_UUID)
    expect(c.displayName).to.be('TestDuration')
    expect(c.props.format).to.be(hap.Formats.UINT32)
    expect(c.props.unit).to.be(hap.Units.SECONDS)
    expect(c.props.perms).to.eql([hap.Perms.PAIRED_READ, hap.Perms.NOTIFY, hap.Perms.PAIRED_WRITE])
    expect(c.value).to.be(0)
  })

  it('exposes the UUID on the class itself', () => {
    expect(types.Characteristic.TestDuration.UUID).to.be(CHAR_UUID)
  })

  it('uses the display name when given', () => {
    types.createCharacteristic('Other', CHAR_UUID, { format: hap.Formats.BOOL, perms: [hap.Perms.PAIRED_READ] }, 'Pretty Name')
    const c = new types.Characteristic.Other()
    expect(c.displayName).to.be('Pretty Name')
  })

  it('creates a service class with required and optional characteristics', () => {
    types.createService('TestService', SERVICE_UUID, [types.Characteristic.TestDuration], [hap.Characteristic.Name])
    const s = new types.Service.TestService('My Service', 'sub1')
    expect(s).to.be.a(hap.Service)
    expect(s.UUID).to.be(SERVICE_UUID)
    expect(s.displayName).to.be('My Service')
    expect(s.subtype).to.be('sub1')
    expect(s.testCharacteristic(types.Characteristic.TestDuration)).to.be(true)
    expect(s.optionalCharacteristics.some(c => c.UUID === hap.Characteristic.Name.UUID)).to.be(true)
    expect(types.Service.TestService.UUID).to.be(SERVICE_UUID)
  })
})
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

```bash
npx mocha test/100_custom_types.js 2>&1 | tail -5
```

Erwartet: `Error: Cannot find module '@homebridge/hap-nodejs'`

- [ ] **Step 4: Paket tauschen**

```bash
npm uninstall hap-nodejs --no-audit --no-fund
npm install @homebridge/hap-nodejs@^2.2.3 --no-audit --no-fund
```

- [ ] **Step 5: `CustomHomeKitTypes.js` umschreiben**

Den Inhalt ab `'use strict'` ersetzen durch (Lizenzkopf bleibt):

```js
'use strict'

let hap

module.exports = class CustomHomeKitTypes {
  constructor (globalHap) {
    hap = globalHap
    this.Characteristic = {}
    this.Service = {}
  }

  createCharacteristic (name, uuid, props, displayName = name) {
    class CustomCharacteristic extends hap.Characteristic {
      constructor () {
        super(displayName, uuid, props)
      }
    }
    CustomCharacteristic.UUID = uuid
    this.Characteristic[name] = CustomCharacteristic
  }

  createService (name, uuid, Characteristics, OptionalCharacteristics = []) {
    class CustomService extends hap.Service {
      constructor (serviceDisplayName, subtype) {
        super(serviceDisplayName, uuid, subtype)
        for (const Characteristic of Characteristics) {
          this.addCharacteristic(Characteristic)
        }
        for (const Characteristic of OptionalCharacteristics) {
          this.addOptionalCharacteristic(Characteristic)
        }
      }
    }
    CustomService.UUID = uuid
    this.Service[name] = CustomService
  }
}
```

- [ ] **Step 6: Test laufen lassen, Erfolg prüfen**

```bash
npx mocha test/100_custom_types.js 2>&1 | tail -8
```

Erwartet: `4 passing`

- [ ] **Step 7: Paketname in allen Quellen und Tests ersetzen**

```bash
grep -rl "require('hap-nodejs')" lib test index.js | xargs sed -i "s/require('hap-nodejs')/require('@homebridge\/hap-nodejs')/g"
grep -rn "require('hap-nodejs')" lib test index.js | wc -l
```

Erwartet: `0`

- [ ] **Step 8: Enums umstellen**

`hap.Characteristic.Formats/Perms/Units` wird `hap.Formats/Perms/Units`. `Perms.READ` wird `Perms.PAIRED_READ`, `Perms.WRITE` wird `Perms.PAIRED_WRITE` (in 2.x gibt es nur noch diese Namen).

```bash
grep -rlE "hap\.Characteristic\.(Formats|Perms|Units)\." lib | xargs sed -i -E 's/hap\.Characteristic\.(Formats|Perms|Units)\./hap.\1./g'
grep -rlE "Perms\.(READ|WRITE)\b" lib | xargs sed -i -E 's/Perms\.READ\b/Perms.PAIRED_READ/g; s/Perms\.WRITE\b/Perms.PAIRED_WRITE/g'
grep -rnE "Characteristic\.(Formats|Perms|Units)\." lib | grep -v "hap\." 
```

Die letzte Zeile listet die vier Dateien mit bloßem `Characteristic.Formats` (HomeMaticVariableAccessory, HomeMaticRadiatorThermostatAccessory, HomeMaticVariableAlarmAccessory, HomeMaticThermostatAccessory). In jeder dieser Dateien:

```bash
for f in lib/services/HomeMaticVariableAccessory.js lib/services/HomeMaticRadiatorThermostatAccessory.js lib/services/HomeMaticVariableAlarmAccessory.js lib/services/HomeMaticThermostatAccessory.js; do
  sed -i -E 's/([^.a-zA-Z])Characteristic\.(Formats|Perms|Units)\./\1\2./g' "$f"
  grep -q "^const { Formats, Perms, Units } = require('@homebridge/hap-nodejs')" "$f" || sed -i "0,/^const path = require('path')/s//const path = require('path')\nconst { Formats, Perms, Units } = require('@homebridge\/hap-nodejs')/" "$f"
done
grep -rnE "(^|[^.a-zA-Z])Characteristic\.(Formats|Perms|Units)\." lib | wc -l
```

Erwartet: `0`. Falls eine der vier Dateien kein `const path = require('path')` hat, den Import von Hand in den Kopfbereich neben die anderen `require`-Zeilen setzen.

- [ ] **Step 9: `Accessory.Categories` ersetzen**

```bash
grep -rn "Accessory.Categories" lib | cut -d: -f1 | sort -u
```

Erwartet: `lib/Server.js` und `lib/services/HomeMaticSPVideoDoorBellAccessory.js`. In `lib/Server.js` die Importzeilen 31 bis 39 ersetzen durch:

```js
const { uuid, Bridge, HAPStorage, Accessory, Service, Characteristic, Categories, Formats, Perms, Units, MDNSAdvertiser } = require('@homebridge/hap-nodejs')
```

(`HAP` gibt es in 2.x nicht mehr; die einzige Verwendung ist ein Kommentar in Zeile 105, der mit gelöscht wird) und in `lib/Server.js` `Accessory.Categories.BRIDGE` durch `Categories.BRIDGE` ersetzen. Das Doorbell-Accessory wird in Task 12 komplett neu geschrieben; dort vorerst nur `Accessory.Categories.VIDEO_DOORBELL` durch `require('@homebridge/hap-nodejs').Categories.VIDEO_DOORBELL` ersetzen, damit das Modul lädt:

```bash
sed -i "s/Accessory\.Categories\.VIDEO_DOORBELL/HAP.Categories.VIDEO_DOORBELL/g" lib/services/HomeMaticSPVideoDoorBellAccessory.js
sed -i "s/Accessory\.Categories\.BRIDGE/Categories.BRIDGE/g" lib/Server.js
```

- [ ] **Step 10: `gatoHomeBridge.hap` um Enums ergänzen und Manufacturer setzen**

In `lib/Server.js` beide Vorkommen von

```js
        hap:
        {
          Characteristic: Characteristic,
          Service: Service
        },
```

ersetzen durch

```js
        hap: { Characteristic, Service, Formats, Perms, Units },
```

und die Zeile `info.setCharacteristic(Characteristic.Manufacturer, 'github.com/thkl')` ändern zu `info.setCharacteristic(Characteristic.Manufacturer, 'github.com/bloop16/homekit-ccu')`.

- [ ] **Step 11: Alle Tests laufen lassen**

```bash
npm test 2>&1 | tail -5
```

Erwartet: `343 passing`. Bei Fehlern der Art `Cannot read properties of undefined (reading 'UINT32')` fehlt eine Enum-Umstellung in der genannten Datei; mit `grep -n "Formats\|Perms\|Units" <datei>` nachsehen und wie in Step 8 beheben.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: migrate to @homebridge/hap-nodejs 2.2.3

- custom characteristics/services are ES classes (util.inherits no longer works)
- Formats/Perms/Units moved to top-level enums, READ/WRITE -> PAIRED_READ/PAIRED_WRITE
- Accessory.Categories -> Categories
- fakegato bridge object exposes Formats/Perms

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: fakegato 0.6.7 und Advertiser-Konfiguration

**Files:**
- Modify: `package.json`, `lib/Server.js:576-580`, `lib/services/HomeMaticAccessory.js:234-246`

- [ ] **Step 1: fakegato aktualisieren und Tests prüfen**

```bash
npm install fakegato-history@^0.6.7 --no-audit --no-fund
npm test 2>&1 | tail -3
```

Erwartet: `343 passing`

- [ ] **Step 2: Advertiser-Auswahl in `Server.js`**

Vor `var publishInfo = {` (Zeile ~574) einfügen:

```js
    const advertiser = this.getAdvertiser()
```

und in `publishInfo` die Zeile `advertiser: "bonjour-hap",` ersetzen durch `advertiser,`. Direkt nach der Methode `getConfig(key)` einfügen:

```js
  /**
   * mDNS advertiser from config.json key "advertiser": bonjour-hap (default), ciao, avahi
   */
  getAdvertiser () {
    const requested = this.getConfig('advertiser') || MDNSAdvertiser.BONJOUR
    const valid = Object.values(MDNSAdvertiser)
    if (!valid.includes(requested)) {
      this.log.warn('[Server] unknown advertiser %s, falling back to %s (valid: %s)', requested, MDNSAdvertiser.BONJOUR, valid.join(', '))
      return MDNSAdvertiser.BONJOUR
    }
    return requested
  }
```

- [ ] **Step 3: Advertiser auch für Einzel-Accessories**

In `lib/services/HomeMaticAccessory.js` `publishSingleAccessory` ändern zu:

```js
  publishSingleAccessory (port) {
    this.port = port
    this.homeKitAccessory.port = this.getPort()
    const publishInfo = Object.assign({ advertiser: this._server.getAdvertiser() }, this.getPublishInfo())
    this.homeKitAccessory.publish(publishInfo, false)
  }
```

- [ ] **Step 4: Test für getAdvertiser in `test/100_custom_types.js` ergänzen**

Am Ende der Datei anhängen:

```js
describe('HomeKit-CCU Server.getAdvertiser', () => {
  const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
  const Server = require(path.join(__dirname, '..', 'lib', 'Server.js'))
  const log = new Logger('HAP Test')
  log.setDebugEnabled(false)

  it('defaults to bonjour-hap', () => {
    const server = new Server(log)
    expect(server.getAdvertiser()).to.be('bonjour-hap')
  })

  it('accepts avahi and ciao', () => {
    const server = new Server(log)
    server._configuration = { advertiser: 'avahi' }
    expect(server.getAdvertiser()).to.be('avahi')
    server._configuration = { advertiser: 'ciao' }
    expect(server.getAdvertiser()).to.be('ciao')
  })

  it('falls back on unknown values', () => {
    const server = new Server(log)
    server._configuration = { advertiser: 'nope' }
    expect(server.getAdvertiser()).to.be('bonjour-hap')
  })
})
```

- [ ] **Step 5: Tests laufen lassen**

```bash
npm test 2>&1 | tail -3
```

Erwartet: `346 passing`

- [ ] **Step 6: Commit, Merge, Push**

```bash
git add -A
git commit -m "feat: configurable mDNS advertiser, fakegato-history 0.6.7

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git checkout master && git merge --ff-only feat/hap2 && git push
```

- [ ] **Step 7: Erster Test auf der OpenCCU (manuell, mit Martin)**

Vorher SSH-Zugang (Host, root-Passwort) erfragen. Dann:

```bash
cd /home/martin/homekit-ccu/addon_installer && sh genscript.sh && ls -la homekit-ccu-0.1.0-dev.tar.gz
```

Das Tarball über die OpenCCU-WebUI (Einstellungen > Systemsteuerung > Zusatzsoftware) installieren. Prüfen per SSH:

```bash
ssh root@<ccu-host> 'tail -50 /var/log/homekit-ccu.log; /etc/config/rc.d/homekit-ccu status'
```

Erwartet: Zeile `homekit-ccu instance ... is running on port 9877`, Bridge in Apple Home sichtbar und pairbar. Ergebnis im CHANGELOG-Entwurf festhalten.

---

## Stufe 3: Dependencies und Lint

### Task 5: commander 14

**Files:**
- Modify: `package.json`, `index.js:34-90`

- [ ] **Step 1: Branch und Paket**

```bash
cd /home/martin/homekit-ccu && git checkout -b feat/deps master
npm install commander@^14 --no-audit --no-fund
```

- [ ] **Step 2: CLI-Teil in `index.js` umschreiben**

Die Zeile `const program = require('commander')` ersetzen durch `const { program } = require('commander')`. Den Block von `program.option('-D, --debug', ...` bis einschließlich `.parse(process.argv)` ersetzen durch:

```js
program
  .name('homekit-ccu')
  .option('-D, --debug', 'turn on debug level logging')
  .option('-C, --configuration <path>', 'set configuration path')
  .option('--reset', 'reset configuration')
  .option('-S, --simulate <path>', 'simulate with a devices file')
  .option('-R, --dryrun', 'only use cached files')
  .option('-L, --log <path>', 'set the path where the log will be created')
  .option('-H, --host <ccuhost>', 'set the host ip for your ccu')
  .option('-U, --user <rpcuser>', 'set the username for XML-RPC basic auth (remote mode)')
  .option('-P, --password <rpcpassword>', 'set the password for XML-RPC basic auth (remote mode)')
  .parse(process.argv)

const opts = program.opts()
if (opts.debug) {
  log.setDebugEnabled(true)
}
if (opts.configuration) {
  configurationPath = opts.configuration
}
if (opts.reset) {
  resetSettings = true
}
if (opts.simulate) {
  console.log('Running a simulation with %s', opts.simulate)
  simulation = opts.simulate
}
if (opts.dryrun) {
  dryRun = true
}
if (opts.log) {
  logPath = opts.log
}
if (opts.host) {
  ccuHost = opts.host
}
if (opts.user) {
  rpcUser = opts.user
}
if (opts.password) {
  rpcPass = opts.password
}
```

- [ ] **Step 3: CLI manuell prüfen**

```bash
node index.js --help | head -14
node index.js -D -S nichtda.json -C /tmp/hk-test 2>&1 | head -3; pkill -f "node index.js" || true
```

Erwartet: Hilfe listet alle neun Optionen; zweiter Aufruf loggt `Running a simulation with nichtda.json`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: upgrade commander to 14, read CLI flags via opts()

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: formidable 3

**Files:**
- Modify: `package.json`, `lib/configurationsrv/index.js` (Methode `processRestore`)

- [ ] **Step 1: Paket**

```bash
npm install formidable@^3 --no-audit --no-fund
```

- [ ] **Step 2: `processRestore` anpassen**

In formidable 3 sind `fields.*` und `files.*` Arrays, die Datei liegt unter `filepath`. Methode ersetzen durch:

```js
  processRestore (request, response) {
    const formidable = require('formidable')
    const form = formidable({ multiples: false })
    const self = this
    const first = (value) => Array.isArray(value) ? value[0] : value
    form.parse(request, async (err, fields, files) => {
      if (err) {
        self.log.error('[Config] restore upload failed: %s', err.message)
      } else if (first(fields.method) === 'restore') {
        const sidOk = await self.checkSid(first(fields.sid), response)
        if (sidOk) {
          const upload = first(files.file)
          if (upload && upload.filepath) {
            if (self.checkAndExtractUploadedConfig(upload.filepath)) {
              self.restartSystem()
            }
          } else {
            self.log.error('[Config] restore: no file in upload')
          }
        }
      }
      if (!response.headersSent) {
        response.writeHead(200, 'OK')
        response.end('OK')
      }
    })
  }
```

Hinweis: `checkSid` ist bereits `async` und schreibt bei ungültiger Session selbst `401`; deshalb der `headersSent`-Schutz.

- [ ] **Step 3: Tests und Modulladen prüfen**

```bash
node -e "require('./lib/configurationsrv/index.js'); console.log('loads')" && npm test 2>&1 | tail -2
```

Erwartet: `loads` und `346 passing`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: upgrade formidable to 3 for config restore upload

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: moment entfernen

**Files:**
- Create: `lib/util/time.js`, `test/101_time_util.js`
- Modify: `lib/services/HomeMaticAccessory.js`, `lib/services/HomeMaticSPTwoSensorWindowAccessory.js`, `lib/services/HomeMaticDoorAccessory.js`, `lib/services/HomeMaticVariableBinarySensorAccessory.js`, `lib/services/HomeMaticGarageDoorOpenerAccessory.js`, `lib/services/HomeMaticContactSensorAccessory.js`, `package.json`

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`test/101_time_util.js`:

```js
const path = require('path')
const expect = require('expect.js')
const { nowUnix } = require(path.join(__dirname, '..', 'lib', 'util', 'time.js'))

describe('HomeKit-CCU time util', () => {
  it('returns whole seconds close to Date.now()', () => {
    const before = Math.floor(Date.now() / 1000)
    const value = nowUnix()
    const after = Math.floor(Date.now() / 1000)
    expect(Number.isInteger(value)).to.be(true)
    expect(value).to.be.within(before, after)
  })
})
```

- [ ] **Step 2: Fehlschlag prüfen**

```bash
npx mocha test/101_time_util.js 2>&1 | tail -3
```

Erwartet: `Cannot find module '.../lib/util/time.js'`

- [ ] **Step 3: Modul schreiben**

`lib/util/time.js`:

```js
'use strict'

/**
 * Current time as unix timestamp in whole seconds (replacement for moment().unix()).
 */
function nowUnix () {
  return Math.floor(Date.now() / 1000)
}

module.exports = { nowUnix }
```

- [ ] **Step 4: moment-Aufrufe ersetzen**

```bash
FILES=$(grep -rl "require('moment')" lib)
echo "$FILES"
for f in $FILES; do
  sed -i "s/const moment = require('moment')/const { nowUnix } = require(path.join(__dirname, '..', 'util', 'time.js'))/" "$f"
  sed -i "s/moment()\.unix()/nowUnix()/g" "$f"
  grep -q "require('path')" "$f" || echo "MISSING path import in $f"
done
grep -rn "moment" lib | grep -v "^lib/configurationsrv/html" | wc -l
npm uninstall moment --no-audit --no-fund
```

Erwartet: sechs Dateien, keine `MISSING`-Zeile, Zähler `0`. Falls `MISSING` erscheint: in der Datei `const path = require('path')` oberhalb der neuen Zeile ergänzen.

- [ ] **Step 5: Tests**

```bash
npm test 2>&1 | tail -3
```

Erwartet: `347 passing`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: replace moment with lib/util/time nowUnix()

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 8: Lint, Coverage, Audit, CI-Gate

**Files:**
- Modify: `package.json`, alle `lib/**/*.js`, `test/*.js`, `index.js`, `.github/workflows/ci.yml`

Ausgangslage: `npx standard` meldet 6274 Verstöße, davon bleiben nach `--fix` 274 (194 `array-callback-return`, 18 `no-case-declarations`, 16 `no-undef`, 8 `no-unused-vars`, 7 `no-async-promise-executor`, 4 `no-redeclare`, 3 `no-empty`, 1 `no-template-curly-in-string`, 1 `no-irregular-whitespace`, 15 Warnungen).

- [ ] **Step 1: Automatische Korrektur als eigener Commit**

```bash
npx standard --fix >/dev/null 2>&1; npm test 2>&1 | tail -2
git add -A && git commit -m "style: apply standard --fix

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Erwartet: `347 passing` vor dem Commit.

- [ ] **Step 2: Verbleibende Verstöße von Hand beheben**

```bash
npx standard 2>&1 | grep -oE "\([a-z-]+\)$" | sort | uniq -c | sort -rn
```

Regel für Regel:

- `array-callback-return`: `.map(x => { ... })` ohne Rückgabewert wird `.forEach(x => { ... })`. Nur ändern, wenn das Ergebnis des `.map` nicht verwendet wird (kein `const y = `, kein `return`, kein Verkettung dahinter).
- `no-case-declarations`: `case 'x': const a = ...` wird `case 'x': { const a = ... break }`.
- `no-undef`: fehlendes `require` oder Tippfehler; Variable deklarieren oder importieren. Bei absichtlichen Globals (Browser-Code ist per `standard.ignore` schon ausgeschlossen) `/* global name */` am Dateikopf.
- `no-unused-vars`: Variable oder Import entfernen.
- `no-async-promise-executor`: `new Promise(async (resolve, reject) => { ... })` wird zu einer `async`-Funktion mit `try/await`, deren Fehler per `throw` nach außen gehen; Aufrufer bleiben gleich, weil `async` ebenfalls ein Promise liefert.
- `no-redeclare`: zweite `var x`-Deklaration im selben Scope entfernen.
- `no-empty`: leeren Block mit Kommentar `// intentionally empty` füllen.
- `no-template-curly-in-string`: Anführungszeichen in Backticks ändern, wenn Interpolation gemeint war, sonst `${` in `$\{` maskieren.
- `no-irregular-whitespace`: das Zeichen durch ein normales Leerzeichen ersetzen.

Nach jeder Datei `npm test`. Am Ende:

```bash
npx standard && echo LINT-OK
```

Erwartet: `LINT-OK`

- [ ] **Step 3: Scripts, Coverage und Audit**

In `package.json` `scripts` ergänzen bzw. ändern:

```json
"test": "mocha",
"lint": "standard",
"coverage": "c8 --include 'lib/services/camera/**' --include lib/services/CustomHomeKitTypes.js --include lib/util/time.js --check-coverage --lines 80 mocha",
```

und die veralteten Scripts `update`, `restart`, `preversion`, `prebuild`, `version`, `postversion` sowie den `husky`-Block und die devDependency `husky` entfernen (der Release-Workflow übernimmt die Versionierung). **Achtung (aus Review Stufe 3):** `restartSystem()` und `updateSystem()` im Config-Server lasen diese npm-Scripts; sie wurden auf einen direkten Aufruf von `/etc/config/rc.d/homekit-ccu restart` (überschreibbar per `HOMEKIT_CCU_RCD`) umgestellt, `update` liefert jetzt einen Hinweis auf den Addon-Installer.

```bash
npm install --save-dev standard@^17 c8@^10 --no-audit --no-fund
npm uninstall husky --no-audit --no-fund
npm audit 2>&1 | tail -3
```

Erwartet: `found 0 vulnerabilities`. Falls nicht: `npm audit` zeigt das Paket; `npm update <paket>` oder `overrides` in `package.json` ergänzen und erneut prüfen.

- [ ] **Step 4: Lint in CI aktivieren**

In `.github/workflows/ci.yml` vor `- run: npm test` einfügen: `- run: npm run lint`. Gleiches in `.github/workflows/release.yml`.

- [ ] **Step 5: Commit, Merge, Push**

```bash
npm test 2>&1 | tail -2 && npx standard && git add -A
git commit -m "chore: lint clean with standard, add c8 coverage script, drop husky

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git checkout master && git merge --ff-only feat/deps && git push
```

---

## Stufe 4: Video-Klingel

Alle Kamera-Module nutzen nur `require('@homebridge/hap-nodejs')` für Enums und den Controller; ffmpeg wird ausschließlich über `FfmpegProcess` aufgerufen.

### Task 9: Argument-Builder `ffmpegArgs.js`

**Files:**
- Create: `lib/services/camera/ffmpegArgs.js`, `test/102_ffmpeg_args.js`

- [ ] **Step 1: Branch**

```bash
cd /home/martin/homekit-ccu && git checkout -b feat/camera master && mkdir -p lib/services/camera test/fixtures
```

- [ ] **Step 2: Fehlschlagende Tests schreiben**

`test/102_ffmpeg_args.js`:

```js
const path = require('path')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const args = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'ffmpegArgs.js'))

const settings = {
  source: '-re -i rtsp://cam/stream',
  stillImageSource: '-i http://cam/snap.jpg',
  vcodec: 'libx264',
  maxWidth: 1280,
  maxHeight: 720,
  maxFPS: 15,
  maxBitrate: 1000
}

const session = {
  address: '192.168.1.20',
  addressVersion: 'ipv4',
  videoPort: 50000,
  videoSSRC: 1234,
  videoSRTP: Buffer.from('0123456789abcdef0123456789abcdef0123456789ab', 'hex'),
  audioPort: 50002,
  audioSSRC: 5678,
  audioSRTP: Buffer.from('fedcba9876543210fedcba9876543210fedcba987654', 'hex'),
  audioReturnPort: 40000
}

const videoRequest = { width: 1280, height: 720, fps: 15, max_bit_rate: 800, pt: 99, mtu: 1316, ssrc: 1234 }
const opusRequest = { codec: hap.AudioStreamingCodecType.OPUS, channel: 1, sample_rate: hap.AudioStreamingSamplerate.KHZ_16, max_bit_rate: 24, pt: 110, packet_time: 20 }
const aacRequest = { codec: hap.AudioStreamingCodecType.AAC_ELD, channel: 1, sample_rate: hap.AudioStreamingSamplerate.KHZ_16, max_bit_rate: 24, pt: 110, packet_time: 30 }

describe('HomeKit-CCU ffmpegArgs', () => {
  describe('buildSnapshotArgs', () => {
    it('uses the still image source and requested size', () => {
      const a = args.buildSnapshotArgs(settings, { width: 640, height: 480 })
      expect(a.join(' ')).to.be('-i http://cam/snap.jpg -frames:v 1 -filter:v scale=640:480 -f image2 - -hide_banner -loglevel error')
    })

    it('falls back to the video source when no still image source is set', () => {
      const a = args.buildSnapshotArgs({ source: '-i rtsp://cam/stream' }, { width: 320, height: 240 })
      expect(a[0]).to.be('-i')
      expect(a[1]).to.be('rtsp://cam/stream')
    })
  })

  describe('buildStreamArgs', () => {
    it('builds a video-only stream', () => {
      const a = args.buildStreamArgs(settings, session, { video: videoRequest, audio: null }).join(' ')
      expect(a).to.contain('-re -i rtsp://cam/stream')
      expect(a).to.contain('-an')
      expect(a).to.contain('-codec:v libx264 -pix_fmt yuv420p -color_range mpeg -r 15 -preset ultrafast -tune zerolatency')
      expect(a).to.contain('-filter:v scale=1280:720')
      expect(a).to.contain('-b:v 800k')
      expect(a).to.contain('-payload_type 99 -ssrc 1234 -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ' + session.videoSRTP.toString('base64'))
      expect(a).to.contain('srtp://192.168.1.20:50000?rtcpport=50000&pkt_size=1316')
      expect(a).to.not.contain('libopus')
    })

    it('caps resolution, fps and bitrate to settings', () => {
      const a = args.buildStreamArgs(settings, session, { video: { ...videoRequest, width: 1920, height: 1080, fps: 30, max_bit_rate: 4000 }, audio: null }).join(' ')
      expect(a).to.contain('-r 15')
      expect(a).to.contain('scale=1280:720')
      expect(a).to.contain('-b:v 1000k')
    })

    it('uses copy without transcoding flags', () => {
      const a = args.buildStreamArgs({ ...settings, vcodec: 'copy' }, session, { video: videoRequest, audio: null }).join(' ')
      expect(a).to.contain('-codec:v copy')
      expect(a).to.not.contain('-filter:v')
      expect(a).to.not.contain('-preset')
    })

    it('adds an opus audio stream', () => {
      const a = args.buildStreamArgs(settings, session, { video: videoRequest, audio: opusRequest }).join(' ')
      expect(a).to.not.contain('-an')
      expect(a).to.contain('-codec:a libopus -application lowdelay -flags +global_header -ar 16k -b:a 24k -ac 1 -payload_type 110 -ssrc 5678 -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ' + session.audioSRTP.toString('base64'))
      expect(a).to.contain('srtp://192.168.1.20:50002?rtcpport=50002&pkt_size=188')
    })

    it('adds an aac-eld audio stream', () => {
      const a = args.buildStreamArgs(settings, session, { video: videoRequest, audio: aacRequest }).join(' ')
      expect(a).to.contain('-codec:a libfdk_aac -profile:a aac_eld -flags +global_header -ar 16k -b:a 24k -ac 1')
    })
  })

  describe('return audio', () => {
    it('writes an opus SDP for the return channel', () => {
      const sdp = args.buildReturnAudioSdp(session, opusRequest)
      expect(sdp).to.contain('c=IN IP4 192.168.1.20')
      expect(sdp).to.contain('m=audio 40000 RTP/AVP 110')
      expect(sdp).to.contain('a=rtpmap:110 opus/16000/1')
      expect(sdp).to.contain('a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:' + session.audioSRTP.toString('base64'))
    })

    it('writes an aac-eld SDP for the return channel', () => {
      const sdp = args.buildReturnAudioSdp(session, aacRequest)
      expect(sdp).to.contain('a=rtpmap:110 MPEG4-GENERIC/16000/1')
      expect(sdp).to.contain('mode=AAC-hbr')
    })

    it('uses IP6 in the SDP for ipv6 sessions', () => {
      const sdp = args.buildReturnAudioSdp({ ...session, addressVersion: 'ipv6', address: 'fe80::1' }, opusRequest)
      expect(sdp).to.contain('c=IN IP6 fe80::1')
    })

    it('builds the return audio ffmpeg args', () => {
      const a = args.buildReturnAudioArgs('rtsp://cam/talk', opusRequest).join(' ')
      expect(a).to.be('-hide_banner -protocol_whitelist pipe,udp,rtp,file,crypto -f sdp -c:a libopus -i pipe: -codec:a aac -f rtsp rtsp://cam/talk')
    })

    it('uses libfdk_aac decoder for aac-eld return audio', () => {
      const a = args.buildReturnAudioArgs('rtsp://cam/talk', aacRequest).join(' ')
      expect(a).to.contain('-c:a libfdk_aac -i pipe:')
    })
  })
})
```

- [ ] **Step 3: Fehlschlag prüfen**

```bash
npx mocha test/102_ffmpeg_args.js 2>&1 | tail -3
```

Erwartet: `Cannot find module '.../lib/services/camera/ffmpegArgs.js'`

- [ ] **Step 4: Modul schreiben**

`lib/services/camera/ffmpegArgs.js`:

```js
'use strict'

const { AudioStreamingCodecType } = require('@homebridge/hap-nodejs')

const SRTP_SUITE = 'AES_CM_128_HMAC_SHA1_80'
const AUDIO_PKT_SIZE = 188

/**
 * Split a user supplied ffmpeg input string ("-re -i rtsp://...") into argv parts.
 */
function splitInput (input) {
  return String(input || '').trim().split(/\s+/).filter(Boolean)
}

function scaleFilter (width, height) {
  return `scale=${width}:${height}`
}

/**
 * Clamp requested video parameters to the configured maxima.
 */
function clampVideo (settings, video) {
  const width = Math.min(video.width, settings.maxWidth || video.width)
  const height = Math.min(video.height, settings.maxHeight || video.height)
  const fps = Math.min(video.fps, settings.maxFPS || video.fps)
  const bitrate = Math.min(video.max_bit_rate, settings.maxBitrate || video.max_bit_rate)
  return { width, height, fps, bitrate }
}

function buildSnapshotArgs (settings, request) {
  const input = splitInput(settings.stillImageSource || settings.source)
  return [
    ...input,
    '-frames:v', '1',
    '-filter:v', scaleFilter(request.width, request.height),
    '-f', 'image2', '-',
    '-hide_banner', '-loglevel', 'error'
  ]
}

function videoEncoderArgs (settings, video) {
  const vcodec = settings.vcodec || 'libx264'
  if (vcodec === 'copy') {
    return ['-codec:v', 'copy']
  }
  const { width, height, fps, bitrate } = clampVideo(settings, video)
  return [
    '-codec:v', vcodec,
    '-pix_fmt', 'yuv420p',
    '-color_range', 'mpeg',
    '-r', String(fps),
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-filter:v', scaleFilter(width, height),
    '-b:v', `${bitrate}k`
  ]
}

function audioEncoderArgs (audio) {
  const codec = audio.codec === AudioStreamingCodecType.AAC_ELD
    ? ['-codec:a', 'libfdk_aac', '-profile:a', 'aac_eld']
    : ['-codec:a', 'libopus', '-application', 'lowdelay']
  return [
    ...codec,
    '-flags', '+global_header',
    '-ar', `${audio.sample_rate}k`,
    '-b:a', `${audio.max_bit_rate}k`,
    '-ac', String(audio.channel)
  ]
}

function srtpOutput (pt, ssrc, srtp, address, port, pktSize) {
  return [
    '-payload_type', String(pt),
    '-ssrc', String(ssrc),
    '-f', 'rtp',
    '-srtp_out_suite', SRTP_SUITE,
    '-srtp_out_params', srtp.toString('base64'),
    `srtp://${address}:${port}?rtcpport=${port}&pkt_size=${pktSize}`
  ]
}

/**
 * ffmpeg argv for a HomeKit live stream.
 * @param settings  { source, vcodec, maxWidth, maxHeight, maxFPS, maxBitrate }
 * @param session   { address, videoPort, videoSSRC, videoSRTP, audioPort, audioSSRC, audioSRTP }
 * @param request   { video: VideoInfo, audio: AudioInfo|null }
 */
function buildStreamArgs (settings, session, request) {
  const args = ['-hide_banner', '-loglevel', 'error', ...splitInput(settings.source)]
  if (!request.audio) {
    args.push('-an')
  }
  args.push(...videoEncoderArgs(settings, request.video))
  args.push(...srtpOutput(request.video.pt, session.videoSSRC, session.videoSRTP, session.address, session.videoPort, request.video.mtu))
  if (request.audio) {
    args.push(...audioEncoderArgs(request.audio))
    args.push(...srtpOutput(request.audio.pt, session.audioSSRC, session.audioSRTP, session.address, session.audioPort, AUDIO_PKT_SIZE))
  }
  return args
}

/**
 * SDP describing the SRTP return-audio stream HomeKit sends to us; fed to ffmpeg via stdin.
 */
function buildReturnAudioSdp (session, audio) {
  const ipVer = session.addressVersion === 'ipv6' ? 'IP6' : 'IP4'
  const rate = audio.sample_rate * 1000
  const rtpmap = audio.codec === AudioStreamingCodecType.AAC_ELD
    ? [
        `a=rtpmap:${audio.pt} MPEG4-GENERIC/${rate}/${audio.channel}`,
        `a=fmtp:${audio.pt} profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3;config=F8F0212C00BC00`
      ]
    : [`a=rtpmap:${audio.pt} opus/${rate}/${audio.channel}`]
  return [
    'v=0',
    `o=- 0 0 IN ${ipVer} ${session.address}`,
    's=Talk',
    `c=IN ${ipVer} ${session.address}`,
    't=0 0',
    `m=audio ${session.audioReturnPort} RTP/AVP ${audio.pt}`,
    `b=AS:${audio.max_bit_rate}`,
    ...rtpmap,
    'a=rtcp-mux',
    `a=crypto:1 ${SRTP_SUITE} inline:${session.audioSRTP.toString('base64')}`
  ].join('\r\n') + '\r\n'
}

/**
 * ffmpeg argv that reads the SDP from stdin and pushes decoded audio to the return target.
 */
function buildReturnAudioArgs (returnTarget, audio) {
  const decoder = audio.codec === AudioStreamingCodecType.AAC_ELD ? 'libfdk_aac' : 'libopus'
  return [
    '-hide_banner',
    '-protocol_whitelist', 'pipe,udp,rtp,file,crypto',
    '-f', 'sdp',
    '-c:a', decoder,
    '-i', 'pipe:',
    '-codec:a', 'aac',
    '-f', 'rtsp', returnTarget
  ]
}

module.exports = { buildSnapshotArgs, buildStreamArgs, buildReturnAudioSdp, buildReturnAudioArgs, splitInput }
```

- [ ] **Step 5: Tests grün**

```bash
npx mocha test/102_ffmpeg_args.js 2>&1 | tail -4 && npx standard lib/services/camera test/102_ffmpeg_args.js && echo LINT-OK
```

Erwartet: `12 passing`, `LINT-OK`

- [ ] **Step 6: Commit**

```bash
git add lib/services/camera/ffmpegArgs.js test/102_ffmpeg_args.js
git commit -m "feat(camera): pure ffmpeg argument and SDP builders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 10: `FfmpegProcess` und Fake-ffmpeg

**Files:**
- Create: `lib/services/camera/FfmpegProcess.js`, `test/fixtures/fake-ffmpeg.sh`, `test/103_ffmpeg_process.js`

- [ ] **Step 1: Fake-ffmpeg schreiben**

`test/fixtures/fake-ffmpeg.sh`:

```sh
#!/bin/sh
# Fake ffmpeg for tests. Behaviour is chosen by the argument list:
#   -encoders          -> prints an encoder list (FAKE_ENCODERS env overrides)
#   -f image2 -        -> writes a fake JPEG header to stdout and exits 0
#   -f sdp ... pipe:   -> reads stdin until EOF, then sleeps until killed
#   anything else      -> sleeps until killed (FAKE_EXIT_CODE env makes it exit immediately)
case " $* " in
  *" -encoders "*)
    echo "Encoders:"
    echo "${FAKE_ENCODERS:- A..... libopus            libopus Opus
 A..... libfdk_aac         Fraunhofer FDK AAC
 V..... libx264            libx264 H.264}"
    exit 0 ;;
  *" -f image2 - "*)
    printf '\377\330\377\340FAKEJPEG'
    exit 0 ;;
esac
if [ -n "$FAKE_EXIT_CODE" ]; then
  echo "fake ffmpeg failing" >&2
  exit "$FAKE_EXIT_CODE"
fi
case " $* " in
  *" -f sdp "*) cat >/dev/null ;;
esac
while :; do sleep 1; done
```

```bash
chmod +x test/fixtures/fake-ffmpeg.sh
FAKE_EXIT_CODE=3 test/fixtures/fake-ffmpeg.sh -i x; echo "exit=$?"
test/fixtures/fake-ffmpeg.sh -hide_banner -encoders | head -2
```

Erwartet: `exit=3` und die Zeilen `Encoders:` und `libopus`.

- [ ] **Step 2: Fehlschlagende Tests schreiben**

`test/103_ffmpeg_process.js`:

```js
const path = require('path')
const expect = require('expect.js')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const FfmpegProcess = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'FfmpegProcess.js'))

const FAKE = path.join(__dirname, 'fixtures', 'fake-ffmpeg.sh')
const log = new Logger('HAP Test')
log.setDebugEnabled(false)

describe('HomeKit-CCU FfmpegProcess', () => {
  it('probes available encoders synchronously', () => {
    const encoders = FfmpegProcess.probeEncoders(FAKE, log)
    expect(encoders.has('libopus')).to.be(true)
    expect(encoders.has('libfdk_aac')).to.be(true)
    expect(encoders.has('libx264')).to.be(true)
    expect(encoders.has('nope')).to.be(false)
  })

  it('returns an empty set when the binary is missing', () => {
    const encoders = FfmpegProcess.probeEncoders('/nonexistent/ffmpeg', log)
    expect(encoders.size).to.be(0)
  })

  it('collects stdout for snapshots', async () => {
    const buf = await FfmpegProcess.collectStdout(FAKE, ['-i', 'x', '-f', 'image2', '-'], log, 2000)
    expect(buf.slice(0, 2)).to.eql(Buffer.from([0xff, 0xd8]))
    expect(buf.toString()).to.contain('FAKEJPEG')
  })

  it('rejects collectStdout on timeout', async () => {
    let error
    try {
      await FfmpegProcess.collectStdout(FAKE, ['-i', 'x'], log, 200)
    } catch (e) { error = e }
    expect(error).to.be.an(Error)
    expect(error.message).to.contain('timeout')
  })

  it('starts, reports running and stops a long running process', async () => {
    const exits = []
    const proc = new FfmpegProcess('video', FAKE, ['-i', 'x'], log, { onExit: (code, signal) => exits.push({ code, signal }) })
    proc.start()
    expect(proc.isRunning()).to.be(true)
    await proc.stop()
    expect(proc.isRunning()).to.be(false)
    expect(exits.length).to.be(1)
    expect(exits[0].signal).to.be('SIGKILL')
  })

  it('reports unexpected exit with code', (done) => {
    const proc = new FfmpegProcess('video', FAKE, ['-i', 'x'], log, {
      env: { FAKE_EXIT_CODE: '3' },
      onExit: (code, signal, expected) => {
        expect(code).to.be(3)
        expect(expected).to.be(false)
        done()
      }
    })
    proc.start()
  })

  it('writes stdin and closes it', async () => {
    const proc = new FfmpegProcess('return', FAKE, ['-f', 'sdp', '-i', 'pipe:'], log, {})
    proc.start()
    proc.writeStdin('v=0\r\n')
    expect(proc.isRunning()).to.be(true)
    await proc.stop()
    expect(proc.isRunning()).to.be(false)
  })
})
```

- [ ] **Step 3: Fehlschlag prüfen**

```bash
npx mocha test/103_ffmpeg_process.js 2>&1 | tail -3
```

Erwartet: `Cannot find module '.../FfmpegProcess.js'`

- [ ] **Step 4: Modul schreiben**

`lib/services/camera/FfmpegProcess.js`:

```js
'use strict'

const { spawn, spawnSync } = require('child_process')

const ENCODER_LINE = /^\s*[AVS][.A-Z]{5}\s+(\S+)/

/**
 * Thin wrapper around one ffmpeg child process.
 * options: { env, onExit(code, signal, expected) }
 */
class FfmpegProcess {
  constructor (label, ffmpegPath, args, log, options = {}) {
    this.label = label
    this.ffmpegPath = ffmpegPath
    this.args = args
    this.log = log
    this.env = Object.assign({}, process.env, options.env || {})
    this.onExit = options.onExit || (() => {})
    this.child = null
    this.expectedExit = false
  }

  start () {
    this.log.debug('[ffmpeg:%s] %s %s', this.label, this.ffmpegPath, this.args.join(' '))
    this.child = spawn(this.ffmpegPath, this.args, { env: this.env, stdio: ['pipe', 'ignore', 'pipe'] })
    this.child.stderr.on('data', (data) => this.log.debug('[ffmpeg:%s] %s', this.label, String(data).trim()))
    this.child.on('error', (err) => this.log.error('[ffmpeg:%s] spawn error: %s', this.label, err.message))
    this.child.on('exit', (code, signal) => {
      const expected = this.expectedExit
      if (!expected) {
        this.log.warn('[ffmpeg:%s] exited unexpectedly (code %s, signal %s)', this.label, code, signal)
      }
      this.child = null
      this.onExit(code, signal, expected)
    })
    return this
  }

  isRunning () {
    return this.child !== null
  }

  writeStdin (data) {
    if (this.child && this.child.stdin.writable) {
      this.child.stdin.write(data)
      this.child.stdin.end()
    }
  }

  /**
   * Kill the process and resolve once it has exited.
   */
  stop () {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve()
        return
      }
      this.expectedExit = true
      this.child.once('exit', () => resolve())
      this.child.kill('SIGKILL')
    })
  }

  /**
   * Run ffmpeg -encoders once and return the set of encoder names. Empty set if ffmpeg is unusable.
   */
  static probeEncoders (ffmpegPath, log) {
    const result = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 10000 })
    if (result.error || result.status !== 0) {
      log.warn('[ffmpeg] encoder probe failed for %s: %s', ffmpegPath, result.error ? result.error.message : `exit ${result.status}`)
      return new Set()
    }
    const encoders = new Set()
    for (const line of result.stdout.split('\n')) {
      const match = ENCODER_LINE.exec(line)
      if (match) {
        encoders.add(match[1])
      }
    }
    return encoders
  }

  /**
   * Run ffmpeg and resolve with everything it wrote to stdout (used for snapshots).
   */
  static collectStdout (ffmpegPath, args, log, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const chunks = []
      const child = spawn(ffmpegPath, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`ffmpeg snapshot timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      child.stdout.on('data', (data) => chunks.push(data))
      child.stderr.on('data', (data) => log.debug('[ffmpeg:snapshot] %s', String(data).trim()))
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          resolve(Buffer.concat(chunks))
        } else {
          reject(new Error(`ffmpeg snapshot exited with code ${code}`))
        }
      })
    })
  }
}

module.exports = FfmpegProcess
```

- [ ] **Step 5: Tests grün**

```bash
npx mocha test/103_ffmpeg_process.js 2>&1 | tail -4 && npx standard lib/services/camera test/103_ffmpeg_process.js && echo LINT-OK
```

Erwartet: `7 passing`, `LINT-OK`

- [ ] **Step 6: Commit**

```bash
git add lib/services/camera/FfmpegProcess.js test/fixtures/fake-ffmpeg.sh test/103_ffmpeg_process.js
git commit -m "feat(camera): FfmpegProcess wrapper with encoder probe and snapshot collector

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 11: Streaming-Optionen und UDP-Port-Helfer

**Files:**
- Create: `lib/services/camera/streamingOptions.js`, `lib/services/camera/udpPort.js`, `test/105_streaming_options.js`

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`test/105_streaming_options.js`:

```js
const path = require('path')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const { buildStreamingOptions } = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'streamingOptions.js'))
const { reserveUdpPort } = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'udpPort.js'))

describe('HomeKit-CCU streamingOptions', () => {
  it('offers video with all profiles and levels', () => {
    const o = buildStreamingOptions({ encoders: new Set(), audio: false, twoWay: false })
    expect(o.supportedCryptoSuites).to.eql([hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80])
    expect(o.video.codec.profiles).to.eql([hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH])
    expect(o.video.codec.levels).to.eql([hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0])
    expect(o.video.resolutions).to.contain([1920, 1080, 30])
    expect(o.video.resolutions).to.contain([320, 180, 30])
    expect(o.audio).to.be(undefined)
  })

  it('offers opus and aac-eld when both encoders exist', () => {
    const o = buildStreamingOptions({ encoders: new Set(['libopus', 'libfdk_aac']), audio: true, twoWay: false })
    expect(o.audio.codecs.map(c => c.type)).to.eql([hap.AudioStreamingCodecType.OPUS, hap.AudioStreamingCodecType.AAC_ELD])
    expect(o.audio.codecs[0].samplerate).to.be(hap.AudioStreamingSamplerate.KHZ_16)
    expect(o.audio.codecs[0].audioChannels).to.be(1)
    expect(o.audio.twoWayAudio).to.be(false)
  })

  it('offers only the available encoder', () => {
    const o = buildStreamingOptions({ encoders: new Set(['libopus']), audio: true, twoWay: true })
    expect(o.audio.codecs.map(c => c.type)).to.eql([hap.AudioStreamingCodecType.OPUS])
    expect(o.audio.twoWayAudio).to.be(true)
  })

  it('drops audio when no encoder is available', () => {
    const o = buildStreamingOptions({ encoders: new Set(['libx264']), audio: true, twoWay: true })
    expect(o.audio).to.be(undefined)
  })

  it('drops audio when disabled in settings', () => {
    const o = buildStreamingOptions({ encoders: new Set(['libopus']), audio: false, twoWay: true })
    expect(o.audio).to.be(undefined)
  })
})

describe('HomeKit-CCU udpPort', () => {
  it('reserves a free port', async () => {
    const port = await reserveUdpPort('ipv4')
    expect(port).to.be.within(1024, 65535)
  })
})
```

- [ ] **Step 2: Fehlschlag prüfen**

```bash
npx mocha test/105_streaming_options.js 2>&1 | tail -3
```

Erwartet: `Cannot find module '.../streamingOptions.js'`

- [ ] **Step 3: Module schreiben**

`lib/services/camera/streamingOptions.js`:

```js
'use strict'

const { SRTPCryptoSuites, H264Profile, H264Level, AudioStreamingCodecType, AudioStreamingSamplerate } = require('@homebridge/hap-nodejs')

const RESOLUTIONS = [
  [1920, 1080, 30], [1280, 960, 30], [1280, 720, 30], [1024, 768, 30], [640, 480, 30],
  [640, 360, 30], [480, 360, 30], [480, 270, 30], [320, 240, 30], [320, 240, 15], [320, 180, 30]
]

const AUDIO_ENCODERS = [
  { type: AudioStreamingCodecType.OPUS, encoder: 'libopus' },
  { type: AudioStreamingCodecType.AAC_ELD, encoder: 'libfdk_aac' }
]

/**
 * Build hap CameraStreamingOptions.
 * @param {{ encoders: Set<string>, audio: boolean, twoWay: boolean }} input
 */
function buildStreamingOptions ({ encoders, audio, twoWay }) {
  const options = {
    supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
    video: {
      codec: {
        profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
        levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0]
      },
      resolutions: RESOLUTIONS
    }
  }
  const codecs = audio
    ? AUDIO_ENCODERS.filter(c => encoders.has(c.encoder)).map(c => ({
      type: c.type,
      samplerate: AudioStreamingSamplerate.KHZ_16,
      audioChannels: 1
    }))
    : []
  if (codecs.length > 0) {
    options.audio = { codecs, twoWayAudio: twoWay }
  }
  return options
}

module.exports = { buildStreamingOptions, AUDIO_ENCODERS }
```

`lib/services/camera/udpPort.js`:

```js
'use strict'

const dgram = require('dgram')

/**
 * Bind a UDP socket to port 0, read the assigned port, close the socket and return the port.
 * There is a small race until ffmpeg binds it, which is acceptable for local use.
 */
function reserveUdpPort (addressVersion = 'ipv4') {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(addressVersion === 'ipv6' ? 'udp6' : 'udp4')
    socket.once('error', reject)
    socket.bind(0, () => {
      const port = socket.address().port
      socket.close(() => resolve(port))
    })
  })
}

module.exports = { reserveUdpPort }
```

- [ ] **Step 4: Tests grün**

```bash
npx mocha test/105_streaming_options.js 2>&1 | tail -4 && npx standard lib/services/camera test/105_streaming_options.js && echo LINT-OK
```

Erwartet: `6 passing`, `LINT-OK`

- [ ] **Step 5: Commit**

```bash
git add lib/services/camera/streamingOptions.js lib/services/camera/udpPort.js test/105_streaming_options.js
git commit -m "feat(camera): streaming options builder and UDP port reservation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 12: `StreamingDelegate`

**Files:**
- Create: `lib/services/camera/StreamingDelegate.js`, `test/104_streaming_delegate.js`

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`test/104_streaming_delegate.js`:

```js
const path = require('path')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const Logger = require(path.join(__dirname, '..', 'lib', 'logger.js'))
const StreamingDelegate = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'StreamingDelegate.js'))

const FAKE = path.join(__dirname, 'fixtures', 'fake-ffmpeg.sh')
const log = new Logger('HAP Test')
log.setDebugEnabled(false)

const settings = {
  ffmpegPath: FAKE,
  source: '-i rtsp://cam/stream',
  stillImageSource: '-i http://cam/snap.jpg',
  vcodec: 'libx264',
  maxWidth: 1280,
  maxHeight: 720,
  maxFPS: 15,
  maxBitrate: 1000,
  audio: true,
  returnAudioTarget: ''
}

const key = Buffer.alloc(16, 1)
const salt = Buffer.alloc(14, 2)

function prepareRequest (sessionID) {
  return {
    sessionID,
    sourceAddress: '192.168.1.5',
    targetAddress: '192.168.1.20',
    addressVersion: 'ipv4',
    video: { port: 50000, srtpCryptoSuite: hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80, srtp_key: key, srtp_salt: salt },
    audio: { port: 50002, srtpCryptoSuite: hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80, srtp_key: key, srtp_salt: salt }
  }
}

function startRequest (sessionID, withAudio) {
  return {
    sessionID,
    type: hap.StreamRequestTypes.START,
    video: { codec: 0, profile: 1, level: 0, packetizationMode: 0, width: 1280, height: 720, fps: 15, pt: 99, ssrc: 1, max_bit_rate: 800, rtcp_interval: 0.5, mtu: 1316 },
    audio: withAudio
      ? { codec: hap.AudioStreamingCodecType.OPUS, channel: 1, bit_rate: 0, sample_rate: hap.AudioStreamingSamplerate.KHZ_16, packet_time: 20, pt: 110, ssrc: 2, max_bit_rate: 24, rtcp_interval: 5, comfort_pt: 13, comfortNoiseEnabled: false }
      : undefined
  }
}

function prepare (delegate, sessionID) {
  return new Promise((resolve, reject) => {
    delegate.prepareStream(prepareRequest(sessionID), (err, response) => err ? reject(err) : resolve(response))
  })
}

function stream (delegate, request) {
  return new Promise((resolve, reject) => {
    delegate.handleStreamRequest(request, (err) => err ? reject(err) : resolve())
  })
}

describe('HomeKit-CCU StreamingDelegate', () => {
  let delegate
  let forced

  beforeEach(() => {
    forced = []
    delegate = new StreamingDelegate('Test Door', settings, log)
    delegate.attachController({ forceStopStreamingSession: (id) => forced.push(id) })
  })

  afterEach(async () => {
    await delegate.shutdown()
  })

  it('answers snapshot requests with the image from ffmpeg', (done) => {
    delegate.handleSnapshotRequest({ width: 640, height: 480 }, (err, buffer) => {
      expect(err).to.be(undefined)
      expect(buffer.toString()).to.contain('FAKEJPEG')
      done()
    })
  })

  it('reports snapshot errors instead of throwing', (done) => {
    const broken = new StreamingDelegate('Broken', { ...settings, ffmpegPath: '/nonexistent/ffmpeg' }, log)
    broken.handleSnapshotRequest({ width: 640, height: 480 }, (err, buffer) => {
      expect(err).to.be.an(Error)
      expect(buffer).to.be(undefined)
      done()
    })
  })

  it('prepares a session with fresh ssrcs and local ports', async () => {
    const response = await prepare(delegate, 'sess-1')
    expect(response.video.ssrc).to.be.a('number')
    expect(response.audio.ssrc).to.be.a('number')
    expect(response.video.ssrc).to.not.be(response.audio.ssrc)
    expect(response.video.port).to.be.within(1024, 65535)
    expect(response.video.srtp_key).to.eql(key)
    expect(response.audio.srtp_salt).to.eql(salt)
    expect(delegate.pendingSessions.has('sess-1')).to.be(true)
    const session = delegate.pendingSessions.get('sess-1')
    expect(session.address).to.be('192.168.1.20')
    expect(session.videoPort).to.be(50000)
    expect(session.videoSRTP).to.eql(Buffer.concat([key, salt]))
  })

  it('starts and stops a video/audio stream', async () => {
    await prepare(delegate, 'sess-2')
    await stream(delegate, startRequest('sess-2', true))
    expect(delegate.pendingSessions.has('sess-2')).to.be(false)
    const active = delegate.ongoingSessions.get('sess-2')
    expect(active.main.isRunning()).to.be(true)
    expect(active.returnAudio).to.be(null)
    await stream(delegate, { sessionID: 'sess-2', type: hap.StreamRequestTypes.STOP })
    expect(delegate.ongoingSessions.has('sess-2')).to.be(false)
    expect(active.main.isRunning()).to.be(false)
  })

  it('starts a return audio process when a target is configured', async () => {
    await delegate.shutdown()
    delegate = new StreamingDelegate('Test Door', { ...settings, returnAudioTarget: 'rtsp://cam/talk' }, log)
    delegate.attachController({ forceStopStreamingSession: (id) => forced.push(id) })
    await prepare(delegate, 'sess-3')
    await stream(delegate, startRequest('sess-3', true))
    const active = delegate.ongoingSessions.get('sess-3')
    expect(active.returnAudio.isRunning()).to.be(true)
    await stream(delegate, { sessionID: 'sess-3', type: hap.StreamRequestTypes.STOP })
    expect(active.returnAudio.isRunning()).to.be(false)
  })

  it('acknowledges reconfigure without touching the process', async () => {
    await prepare(delegate, 'sess-4')
    await stream(delegate, startRequest('sess-4', false))
    const active = delegate.ongoingSessions.get('sess-4')
    await stream(delegate, { sessionID: 'sess-4', type: hap.StreamRequestTypes.RECONFIGURE, video: { width: 640, height: 480, fps: 10, max_bit_rate: 300, rtcp_interval: 0.5 } })
    expect(active.main.isRunning()).to.be(true)
  })

  it('forces the session to stop when ffmpeg dies', async () => {
    await delegate.shutdown()
    delegate = new StreamingDelegate('Test Door', settings, log, { env: { FAKE_EXIT_CODE: '2' } })
    delegate.attachController({ forceStopStreamingSession: (id) => forced.push(id) })
    await prepare(delegate, 'sess-5')
    await stream(delegate, startRequest('sess-5', false))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(forced).to.eql(['sess-5'])
    expect(delegate.ongoingSessions.has('sess-5')).to.be(false)
  })

  it('fails a start request for an unknown session', async () => {
    let error
    try {
      await stream(delegate, startRequest('unknown', false))
    } catch (e) { error = e }
    expect(error).to.be.an(Error)
  })
})
```

- [ ] **Step 2: Fehlschlag prüfen**

```bash
npx mocha test/104_streaming_delegate.js 2>&1 | tail -3
```

Erwartet: `Cannot find module '.../StreamingDelegate.js'`

- [ ] **Step 3: Modul schreiben**

`lib/services/camera/StreamingDelegate.js`:

```js
'use strict'

const path = require('path')
const { CameraController, StreamRequestTypes } = require('@homebridge/hap-nodejs')
const FfmpegProcess = require(path.join(__dirname, 'FfmpegProcess.js'))
const { reserveUdpPort } = require(path.join(__dirname, 'udpPort.js'))
const { buildSnapshotArgs, buildStreamArgs, buildReturnAudioSdp, buildReturnAudioArgs } = require(path.join(__dirname, 'ffmpegArgs.js'))

const SNAPSHOT_TIMEOUT_MS = 15000

/**
 * Implements hap CameraStreamingDelegate on top of ffmpeg.
 * settings: { ffmpegPath, source, stillImageSource, vcodec, maxWidth, maxHeight, maxFPS, maxBitrate, audio, returnAudioTarget }
 * options:  { env } (passed to every ffmpeg process, used by tests)
 */
class StreamingDelegate {
  constructor (name, settings, log, options = {}) {
    this.name = name
    this.settings = settings
    this.log = log
    this.processEnv = options.env || {}
    this.controller = null
    this.pendingSessions = new Map()
    this.ongoingSessions = new Map()
  }

  attachController (controller) {
    this.controller = controller
  }

  handleSnapshotRequest (request, callback) {
    const args = buildSnapshotArgs(this.settings, request)
    FfmpegProcess.collectStdout(this.settings.ffmpegPath, args, this.log, SNAPSHOT_TIMEOUT_MS)
      .then((buffer) => callback(undefined, buffer))
      .catch((err) => {
        this.log.error('[Camera %s] snapshot failed: %s', this.name, err.message)
        callback(err)
      })
  }

  prepareStream (request, callback) {
    Promise.all([reserveUdpPort(request.addressVersion), reserveUdpPort(request.addressVersion)])
      .then(([videoReturnPort, audioReturnPort]) => {
        const session = {
          address: request.targetAddress,
          addressVersion: request.addressVersion,
          videoPort: request.video.port,
          videoReturnPort,
          videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
          videoSSRC: CameraController.generateSynchronisationSource(),
          audioPort: request.audio.port,
          audioReturnPort,
          audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
          audioSSRC: CameraController.generateSynchronisationSource()
        }
        this.pendingSessions.set(request.sessionID, session)
        callback(undefined, {
          video: { port: videoReturnPort, ssrc: session.videoSSRC, srtp_key: request.video.srtp_key, srtp_salt: request.video.srtp_salt },
          audio: { port: audioReturnPort, ssrc: session.audioSSRC, srtp_key: request.audio.srtp_key, srtp_salt: request.audio.srtp_salt }
        })
      })
      .catch((err) => {
        this.log.error('[Camera %s] prepareStream failed: %s', this.name, err.message)
        callback(err)
      })
  }

  handleStreamRequest (request, callback) {
    switch (request.type) {
      case StreamRequestTypes.START:
        this.startStream(request, callback)
        break
      case StreamRequestTypes.RECONFIGURE:
        this.log.debug('[Camera %s] reconfigure requested (%sx%s@%s), keeping current stream', this.name, request.video.width, request.video.height, request.video.fps)
        callback()
        break
      case StreamRequestTypes.STOP:
        this.stopStream(request.sessionID).then(() => callback())
        break
      default:
        callback(new Error(`unknown stream request type ${request.type}`))
    }
  }

  startStream (request, callback) {
    const session = this.pendingSessions.get(request.sessionID)
    if (!session) {
      callback(new Error(`no prepared session ${request.sessionID}`))
      return
    }
    this.pendingSessions.delete(request.sessionID)
    const audio = this.settings.audio === false ? null : (request.audio || null)
    const onExit = (code, signal, expected) => {
      if (!expected) {
        this.log.error('[Camera %s] ffmpeg for session %s died (code %s), stopping session', this.name, request.sessionID, code)
        this.stopStream(request.sessionID).then(() => {
          if (this.controller) {
            this.controller.forceStopStreamingSession(request.sessionID)
          }
        })
      }
    }
    const main = new FfmpegProcess('video', this.settings.ffmpegPath, buildStreamArgs(this.settings, session, { video: request.video, audio }), this.log, { env: this.processEnv, onExit })
    let returnAudio = null
    if (audio && this.settings.returnAudioTarget) {
      returnAudio = new FfmpegProcess('return-audio', this.settings.ffmpegPath, buildReturnAudioArgs(this.settings.returnAudioTarget, audio), this.log, { env: this.processEnv, onExit })
    }
    this.ongoingSessions.set(request.sessionID, { session, main, returnAudio })
    main.start()
    if (returnAudio) {
      returnAudio.start()
      returnAudio.writeStdin(buildReturnAudioSdp(session, audio))
    }
    this.log.info('[Camera %s] stream %s started (%sx%s, audio %s, talkback %s)', this.name, request.sessionID, request.video.width, request.video.height, audio ? audio.codec : 'off', returnAudio ? 'on' : 'off')
    callback()
  }

  async stopStream (sessionID) {
    const active = this.ongoingSessions.get(sessionID)
    if (!active) {
      this.pendingSessions.delete(sessionID)
      return
    }
    this.ongoingSessions.delete(sessionID)
    await active.main.stop()
    if (active.returnAudio) {
      await active.returnAudio.stop()
    }
    this.log.info('[Camera %s] stream %s stopped', this.name, sessionID)
  }

  async shutdown () {
    for (const sessionID of Array.from(this.ongoingSessions.keys())) {
      await this.stopStream(sessionID)
    }
    this.pendingSessions.clear()
  }
}

module.exports = StreamingDelegate
```

- [ ] **Step 4: Tests grün**

```bash
npx mocha test/104_streaming_delegate.js 2>&1 | tail -4 && npx standard lib/services/camera test/104_streaming_delegate.js && echo LINT-OK
```

Erwartet: `8 passing`, `LINT-OK`. Falls der Test „forces the session to stop when ffmpeg dies" hängt: prüfen, dass `stdio` des Kindprozesses `['pipe','ignore','pipe']` ist, sonst blockiert stdout.

- [ ] **Step 5: Commit**

```bash
git add lib/services/camera/StreamingDelegate.js test/104_streaming_delegate.js
git commit -m "feat(camera): StreamingDelegate with audio and return audio sessions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 13: Doorbell-Accessory auf `CameraController`, `ffmpeg.js` löschen

**Files:**
- Modify: `lib/services/HomeMaticSPVideoDoorBellAccessory.js`, `lib/configurationsrv/localization/de.json`
- Delete: `lib/services/ffmpeg.js`

- [ ] **Step 1: Accessory umschreiben**

`lib/services/HomeMaticSPVideoDoorBellAccessory.js` komplett ersetzen:

```js
const path = require('path')
const fs = require('fs')
const { Accessory, Categories, CameraController } = require('@homebridge/hap-nodejs')
const HomeMaticAccessory = require(path.join(__dirname, 'HomeMaticAccessory.js'))
const StreamingDelegate = require(path.join(__dirname, 'camera', 'StreamingDelegate.js'))
const FfmpegProcess = require(path.join(__dirname, 'camera', 'FfmpegProcess.js'))
const { buildStreamingOptions } = require(path.join(__dirname, 'camera', 'streamingOptions.js'))

const DEFAULTS = { maxWidth: 1280, maxHeight: 720, maxFPS: 15, maxBitrate: 1000, vcodec: 'libx264' }

/**
 * A plain URL gets the given prefix ("-re -i "); a value that already starts with "-" is taken as raw ffmpeg input args.
 */
function inputArgs (value, prefix) {
  const trimmed = String(value || '').trim()
  return trimmed.startsWith('-') ? trimmed : prefix + trimmed
}

module.exports = class HomeMaticSPVideoDoorBellAccessory extends HomeMaticAccessory {
  createHomeKitAccessory () {
    this.debugLog('publishing services for %s', this.getName())
    this.homeKitAccessory = new Accessory(this._name, this._accessoryUUID, Categories.VIDEO_DOORBELL)
    this.homeKitAccessory.on('identify', (paired, callback) => callback())
    this.homeKitAccessory.log = this.log
  }

  numberSetting (key) {
    const value = parseInt(this.getDeviceSettings(key), 10)
    return Number.isFinite(value) && value > 0 ? value : DEFAULTS[key]
  }

  cameraSettings () {
    return {
      ffmpegPath: this.getDeviceSettings('ffmpegpath') || '/usr/local/bin/ffmpeg',
      source: inputArgs(this.getDeviceSettings('video_source'), '-re -i '),
      stillImageSource: this.getDeviceSettings('video_stillImageSource') ? inputArgs(this.getDeviceSettings('video_stillImageSource'), '-i ') : undefined,
      vcodec: this.getDeviceSettings('vcodec') || DEFAULTS.vcodec,
      maxWidth: this.numberSetting('maxWidth'),
      maxHeight: this.numberSetting('maxHeight'),
      maxFPS: this.numberSetting('maxFPS'),
      maxBitrate: this.numberSetting('maxBitrate'),
      audio: this.getDeviceSettings('audio') !== false && this.getDeviceSettings('audio') !== 'false',
      returnAudioTarget: this.getDeviceSettings('audio_return_target') || ''
    }
  }

  publishServices (Service, Characteristic) {
    const settings = this.cameraSettings()
    if (!fs.existsSync(settings.ffmpegPath)) {
      this.log.error('[Camera %s] ffmpeg not found at %s, doorbell will not be published', this._name, settings.ffmpegPath)
      this.cameraUnavailable = true
      return
    }
    const encoders = FfmpegProcess.probeEncoders(settings.ffmpegPath, this.log)
    const streamingOptions = buildStreamingOptions({ encoders, audio: settings.audio, twoWay: Boolean(settings.returnAudioTarget) })
    if (settings.audio && !streamingOptions.audio) {
      this.log.warn('[Camera %s] ffmpeg has neither libopus nor libfdk_aac, publishing without audio', this._name)
    }
    this.streamingDelegate = new StreamingDelegate(this._name, settings, this.log)
    this.cameraController = new CameraController({ cameraStreamCount: 2, delegate: this.streamingDelegate, streamingOptions })
    this.streamingDelegate.attachController(this.cameraController)
    this.homeKitAccessory.configureController(this.cameraController)
    this.log.info('[Camera %s] published (%s, audio %s, talkback %s)', this._name, settings.vcodec, streamingOptions.audio ? 'on' : 'off', settings.returnAudioTarget ? 'on' : 'off')

    this.addDoorbellService(Service, Characteristic)
  }

  addDoorbellService (Service, Characteristic) {
    const doorBellSensor = this.getDeviceSettings('address_door_bell_key')
    if (!doorBellSensor) {
      return
    }
    const doorbellService = new Service.Doorbell(this._name)
    this.homeKitAccessory.addService(doorbellService)
    this.initialQuery = true
    const dingDong = doorbellService.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .on('get', (callback) => callback(null, 0))
    this.registerAddressForEventProcessingAtAccessory(this.buildAddress(doorBellSensor), () => {
      if (!this.initialQuery) {
        this.debugLog('DingDong')
        dingDong.updateValue(0, null)
      }
      this.initialQuery = false
    })
  }

  publishSingleAccessory (port) {
    if (this.cameraUnavailable) {
      return
    }
    super.publishSingleAccessory(port)
  }

  shutdown () {
    super.shutdown()
    if (this.streamingDelegate) {
      this.streamingDelegate.shutdown()
    }
  }

  isBridgedAccessory () {
    return false
  }

  getPublishInfo () {
    return {
      username: '00:00:11:22:22:11',
      port: this.getPort(),
      pincode: this.getDeviceSettings('pin-code') || '123-45-678',
      category: Categories.VIDEO_DOORBELL
    }
  }

  static serviceDescription () {
    return 'This service provides a Video door bell for HomeKit'
  }

  static configurationItems () {
    return {
      address_door_bell_key: {
        type: 'text',
        label: 'Address door bell indicator',
        selector: 'datapoint',
        hint: '',
        options: { filterChannels: ['KEY', 'VIRTUAL_KEY', 'MULTI_MODE_INPUT_TRANSMITTER'] },
        mandatory: true
      },
      video_source: { type: 'text', hint: 'RTSP URL, or raw ffmpeg input args starting with - (e.g. -f lavfi -i testsrc)', label: 'URL RTSP video', mandatory: true },
      video_stillImageSource: { type: 'text', hint: '', label: 'URL still image', default: '' },
      'pin-code': { type: 'text', hint: '', label: 'PinCode', default: '123-45-678' },
      ffmpegpath: { type: 'text', hint: '', label: 'Path to ffmpg', default: '/usr/local/bin/ffmpeg' },
      vcodec: { type: 'text', hint: 'Use copy when the camera already delivers H.264', label: 'Video codec', default: 'libx264' },
      maxWidth: { type: 'number', hint: '', label: 'Max width', default: 1280 },
      maxHeight: { type: 'number', hint: '', label: 'Max height', default: 720 },
      maxFPS: { type: 'number', hint: '', label: 'Max FPS', default: 15 },
      maxBitrate: { type: 'number', hint: '', label: 'Max bitrate (kbit/s)', default: 1000 },
      audio: { type: 'checkbox', hint: '', label: 'Audio', default: true },
      audio_return_target: { type: 'text', hint: 'ffmpeg output for talkback, empty disables two-way audio', label: 'Talkback target', default: '' }
    }
  }

  static channelTypes () {
    return ['SPECIAL']
  }
}
```

Das bisherige `LockMechanism` entfällt: es war ein Dummy ohne Verbindung zur CCU (öffnete nach einer Sekunde von selbst wieder) und hat keinen Bezug zur Klingel.

- [ ] **Step 2: Lokalisierung ergänzen**

Die Feldtypen `checkbox` und `number` werden von anderen Accessories bereits genutzt (23 bzw. 34 Stellen). Die bestehenden Labels sind in `de.json` vorhanden; die neuen Labels und Hints per Node einfügen:

```bash
node -e "
const fs=require('fs');const p='lib/configurationsrv/localization/de.json';
const j=JSON.parse(fs.readFileSync(p));
Object.assign(j,{
 'Video codec':'Video-Codec',
 'Use copy when the camera already delivers H.264':'copy verwenden, wenn die Kamera bereits H.264 liefert',
 'Max width':'Maximale Breite','Max height':'Maximale Höhe','Max FPS':'Maximale Bildrate',
 'Max bitrate (kbit/s)':'Maximale Bitrate (kbit/s)','Audio':'Audio',
 'Talkback target':'Gegensprech-Ziel',
 'RTSP URL, or raw ffmpeg input args starting with - (e.g. -f lavfi -i testsrc)':'RTSP-URL oder rohe ffmpeg-Eingabeargumente, beginnend mit - (z. B. -f lavfi -i testsrc)',
 'ffmpeg output for talkback, empty disables two-way audio':'ffmpeg-Ausgabe für Gegensprechen, leer deaktiviert Zwei-Wege-Audio'
});
fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');console.log('ok')"
```

- [ ] **Step 3: Alte Implementierung löschen und Tests**

```bash
git rm -q lib/services/ffmpeg.js
node -e "require('./lib/services/HomeMaticSPVideoDoorBellAccessory.js'); console.log('loads')"
npm test 2>&1 | tail -3 && npx standard && echo LINT-OK
```

Erwartet: `loads`, alle Tests grün (Localization-Test 900 prüft die neuen Labels), `LINT-OK`.

- [ ] **Step 4: Coverage prüfen**

```bash
npm run coverage 2>&1 | tail -12
```

Erwartet: Zeilenabdeckung der Kamera-Module über 80 %. Bei Unterschreitung fehlende Zweige in `test/104_streaming_delegate.js` ergänzen (z. B. STOP für unbekannte Session, `audio: false` in den Settings).

- [ ] **Step 5: Commit, Merge, Push**

```bash
git add -A
git commit -m "feat(camera): video doorbell on CameraController with audio and talkback

Replaces the removed StreamController based ffmpeg.js. Doorbell is not
published when ffmpeg is missing; audio codecs depend on available encoders.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git checkout master && git merge --ff-only feat/camera && git push
```

- [ ] **Step 6: Zweiter Test auf der OpenCCU (manuell, mit Martin)**

Tarball wie in Task 4 Step 7 bauen und installieren. Es gibt keine echte Kamera; die Klingel wird im Remote-Modus auf diesem Rechner mit einer synthetischen ffmpeg-Quelle getestet (Testbild plus Sinuston):

```bash
which ffmpeg && ffmpeg -hide_banner -encoders 2>/dev/null | grep -E "libopus|libfdk_aac|libx264"
node index.js -D -H <ccu-host> -C /tmp/hk-remote
```

In der Config-UI eine Video-Klingel anlegen mit *URL RTSP video* `-f lavfi -i testsrc=size=1280x720:rate=15 -f lavfi -i sine=frequency=440` (das Feld wird als ffmpeg-Eingabe übernommen, daher funktionieren lavfi-Quellen; `-re -i` wird dann nicht vorangestellt, siehe Task 13 `cameraSettings`), *URL still image* leer, *Path to ffmpeg* auf das lokale Binary. In Apple Home: Klingel hinzufügen, Testbild als Standbild sichtbar, Live-Stream läuft, 440-Hz-Ton hörbar. Gegensprechen kann ohne Ziel nicht geprüft werden; stattdessen `audio_return_target` auf `-f null -` setzen und im Debug-Log prüfen, dass der Rückkanal-Prozess startet und SDP empfängt. Beobachtungen im CHANGELOG-Entwurf festhalten.

---

## Stufe 5: Installer, Doku, Release

### Task 14: Installer und README

**Files:**
- Modify: `addon_installer/homekit-ccu:12-14, 49-70, 295-300`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Branch**

```bash
cd /home/martin/homekit-ccu && git checkout -b feat/installer master
```

- [ ] **Step 2: rc.d-Skript anpassen**

In `addon_installer/homekit-ccu`:

- Zeile `NODE_VER=20.18.3` löschen.
- Zeile `REQUIRED_MAJOR=20` ändern zu `REQUIRED_MAJOR=22`.
- In `info()` die Zeile `echo "Version: $VER (Node $NODE_VER)"` ändern zu:

```sh
	echo "Version: $VER (Node $(node --version 2>/dev/null || echo 'missing'))"
```

- In `check_node_version()` die Fehlermeldung bei zu altem Node ergänzen:

```sh
    log "install" "ERROR: Node.js ${CURRENT_VERSION} is too old (need >=${REQUIRED_MAJOR}). Update OpenCCU to 3.89 or newer."
```

```bash
sh -n addon_installer/homekit-ccu && echo SYNTAX-OK
grep -n "NODE_VER\|REQUIRED_MAJOR" addon_installer/homekit-ccu
```

Erwartet: `SYNTAX-OK`, nur noch `REQUIRED_MAJOR=22` und dessen Verwendungen.

- [ ] **Step 3: README überarbeiten**

In `README.md`:

- Abschnitt `# Description`: den Satz „Requires Node.js >= 20. OpenCCU and RaspberryMatic ship Node.js as part of the system image. If Node.js is missing or too old, the addon will automatically download and install a compatible version during installation." ersetzen durch:

```markdown
Requires OpenCCU 3.89 or newer, which ships Node.js 22. The addon does not bundle Node.js; if the CCU's Node.js is older than 22 the installation stops with an error in `/var/log/homekit-ccu.log`.
```

- Die Abschnitte `# What's new in 0.0.16` und `# What's new in 0.0.15` durch einen Abschnitt `# What's new in 0.1.0` ersetzen:

```markdown
# What's new in 0.1.0

- HAP stack upgraded from hap-nodejs 0.11 (2023) to @homebridge/hap-nodejs 2.2 (2026): security fixes and current iOS/tvOS 26/27 compatibility
- Video doorbell rewritten on the HAP CameraController: audio (Opus / AAC-ELD) and optional two-way audio
- mDNS advertiser selectable in `config.json` (`"advertiser": "bonjour-hap" | "ciao" | "avahi"`)
- Dependencies refreshed (commander 14, formidable 3, fakegato-history 0.6, moment removed), `npm audit` clean
- GitHub Actions CI and release pipeline; the addon tarball is built on every `v*` tag
- Requires Node.js 22 (OpenCCU 3.89+)
```

- Abschnitt `# Installation`: Link auf `https://github.com/bloop16/homekit-ccu/releases/latest`.
- Neuen Abschnitt nach `# Used Ports` einfügen:

```markdown
# Video Doorbell and ffmpeg

The video doorbell (special accessory) needs an `ffmpeg` binary. OpenCCU does not ship one.

- **Remote mode** (recommended for cameras): run homekit-ccu on a machine that has ffmpeg with `libx264`, `libopus` and ideally `libfdk_aac`.
- **On the CCU**: copy a static build (for example the johnvansickle.com builds for arm64/amd64) to `/usr/local/bin/ffmpeg`, make it executable and set *Path to ffmpeg* in the doorbell settings. Audio is offered only for encoders the binary actually has; without `libopus`/`libfdk_aac` the doorbell is published video-only.
- *Video codec* `copy` avoids transcoding when the camera already delivers H.264. This is the only realistic option on a Raspberry Pi based CCU.
- *Talkback target* is an ffmpeg output (for example `rtsp://camera/talk`); when set, Apple Home shows the talk button.
- *URL RTSP video* accepts a plain RTSP/HTTP URL or, when it starts with `-`, raw ffmpeg input arguments. `-f lavfi -i testsrc=size=1280x720:rate=15 -f lavfi -i sine=frequency=440` gives a test pattern with a tone and needs no camera at all.

# mDNS advertiser

`config.json` accepts `"advertiser"` with `bonjour-hap` (default, works on OpenCCU), `ciao` or `avahi` (uses the CCU's avahi daemon via D-Bus). Change it only if HomeKit cannot discover the bridge.
```

- [ ] **Step 3b: Upstream-Verweise auf den Fork umstellen**

- `package.json`: `repository.url` auf `git+https://github.com/bloop16/homekit-ccu.git` setzen.
- `lib/configurationsrv/html/update-check.cgi` (Zeilen 3-4) prüft bisher `britz/homekit-ccu/master/package.json` und verlinkt auf Britz' Releases. Umstellen auf das letzte Release des Forks: Versionsquelle `https://api.github.com/repos/bloop16/homekit-ccu/releases/latest` mit Regex `"tag_name"\s*:\s*"v([^"]+)"`, Download-Link `https://github.com/bloop16/homekit-ccu/releases/latest`. Vorher die Datei lesen und die Struktur (TCL-CGI) beibehalten.

```bash
grep -rn "britz\|thkl" lib/configurationsrv/html/*.cgi package.json README.md | grep -v "Origin\|hap-homematic\|credit" 
```

Erwartet: keine Treffer mehr außer den Herkunftsangaben im README.

- [ ] **Step 3c: Toter Express-Code (Hinweis aus Review Stufe 3)**

`lib/configurationsrv/configservice.js`, `socketmanager.js`, `ccu.js`, `httpclient.js`, `cfglogger.js`, `routes/*`, `middleware/*` (und vermutlich `settings.js`) benötigen `express`, das keine Dependency ist, und werden von nichts Lebendigem referenziert. Nicht in dieser Iteration löschen; als Folgeprojekt "Config-Server aufräumen" notieren (zusammen mit CORS-Reflektion und fehlendem CSRF-Schutz im Config-Server).

- [ ] **Step 4: CHANGELOG ergänzen**

Am Anfang von `CHANGELOG.md` einfügen:

```markdown
Changelog for 0.1.0:
====================

* Migrated from hap-nodejs 0.11.1 to @homebridge/hap-nodejs 2.2.3 (custom characteristics as ES classes, Formats/Perms/Units enums, Categories)
* Video doorbell rewritten on CameraController: snapshot, stream, Opus/AAC-ELD audio, optional two-way audio via `audio_return_target`; ffmpeg encoder probe decides offered codecs
* Removed the dummy LockMechanism from the video doorbell
* `advertiser` config key (bonjour-hap, ciao, avahi)
* commander 14, formidable 3, fakegato-history 0.6.7; moment replaced by lib/util/time.js
* standard lint clean, c8 coverage script, husky removed
* GitHub Actions CI and release workflow; addon tarball no longer tracked in git
* Installer requires Node.js 22 (OpenCCU 3.89+), README no longer claims automatic Node install
```

Zusätzlich die Testergebnisse der beiden CCU-Tests (Task 4 Step 7, Task 13 Step 6) als Stichpunkte unter `* Verified on OpenCCU <version> with iOS 27: ...` eintragen.

- [ ] **Step 5: Commit, Merge, Push**

```bash
git add -A
git commit -m "docs: installer requires Node 22, README for ffmpeg, advertiser and 0.1.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git checkout master && git merge --ff-only feat/installer && git push
```

### Task 15: Release v0.1.0

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Version setzen**

```bash
cd /home/martin/homekit-ccu && git checkout master && git pull
npm version 0.1.0 --no-git-tag-version
npm test 2>&1 | tail -2 && npx standard && echo LINT-OK
git add package.json package-lock.json
git commit -m "chore: release 0.1.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 2: Tag und Push**

```bash
git tag v0.1.0 && git push && git push origin v0.1.0
```

- [ ] **Step 3: Release prüfen**

```bash
sleep 120; gh run list -R bloop16/homekit-ccu --workflow Release --limit 1
gh release view v0.1.0 -R bloop16/homekit-ccu --json assets --jq '.assets[].name'
```

Erwartet: Run `completed success` und Asset `homekit-ccu-0.1.0.tar.gz`.

- [ ] **Step 4: Abnahme auf der OpenCCU**

Das Release-Tarball über die WebUI installieren und die Abnahmeliste aus dem Spec (Abschnitt 9) abhaken: Installation, Button in der Systemsteuerung, Bridge in Apple Home unter iOS 27, Pairing, Geräte reagieren, Klingel mit Bild, Ton und Gegensprechen.

---

## Selbstprüfung gegen das Spec

- Abschnitt 3 (Repo/Release): Task 1, 2, 15. Tarball und Travis entfernt (Task 1), Release bei Tag (Task 2).
- Abschnitt 4 (HAP): Task 3 (Paket, Enums, Klassen-Factory, Categories, Manufacturer), Task 4 (fakegato, Advertiser).
- Abschnitt 5 (Dependencies): Task 5 bis 8, inklusive `engines` (Task 1), audit und lint (Task 8).
- Abschnitt 6 (Kamera): Task 9 bis 13; Audio-Probe, Zwei-Wege-Audio, Degradation ohne Encoder, Session-Abbruch bei ffmpeg-Absturz, Doku (Task 14). Zusätzliche Einstellung `vcodec` mit `copy` (im Spec nicht gelistet, für Raspberry-Pi-CCUs nötig; Spec nachziehen).
- Abschnitt 7 (Installer): Task 14.
- Abschnitt 8 (Tests): Tests 100 bis 105, Fake-ffmpeg, c8 (Task 8, 13), Lint in CI (Task 8).
- Abschnitt 9 (Stufen/Abnahme): CCU-Tests in Task 4 Step 7, Task 13 Step 6, Task 15 Step 4.
