🇬🇧 English | [🇩🇪 Deutsch](de/devices.md)

# Supported devices

HomeKit-CCU shows HomeMatic, HomematicIP and HomeMatic Wired devices as the accessory types Apple Home knows: a thermostat is a thermostat, a roller shutter a window covering, a remote a set of buttons. When you add a device in the configuration, the native type is preselected. You can pick another type per channel, for example Switch, Outlet or Lightbulb for a switch actuator.

Devices you added before keep their type, so rooms, scenes and automations in Apple Home stay as they are.

The tables list the device families with typical models. Colour variants (`-A`, `-S`), hardware revisions (`-2`, `-3`), country variants (`-UK`, `-CH`, `-PE`, `-IT`, `-NL`), ELV (`ELV-SH-*`), wired (`HmIPW-*`) and rebadged models (Schüco `263 …`, Roto `ZEL STG RM …`) work like the model they are based on.

## Climate

| Devices | In Apple Home | Notes |
|---|---|---|
| Radiator thermostats HmIP-eTRV (all variants), heating groups (HmIP-HEATING), HM-CC-RT-DN | Thermostat | Off, heat and auto; "heating" follows the valve; 0.5 °C steps; optional boost switch |
| Wall thermostats HmIP-WTH, WTH-2, WTH-B, STHD, BWTH, ALPHA-IP-RBG, HM-TC-IT-WM-W-EU | Thermostat + humidity sensor | The humidity sensor makes humidity appear in the room summary |
| Temperature/humidity sensors HmIP-STH, STHO, ELV-SH-CTH, HM-WDS10/20/30/40 | Temperature and humidity sensor | |
| Weather stations HmIP-SWO-B, SWO-PL, SWO-PR, HM-WDS100-C6-O, KS550 | Temperature, humidity and light sensor | Wind, rain and air pressure only in the Eve app, Apple Home has no tiles for them |
| CO₂ sensor HmIP-SCTH230 | Carbon dioxide sensor + temperature and humidity | CO₂ level in ppm |
| CO₂ traffic light HM-CC-SCD | Carbon dioxide sensor + air quality | |
| Particulate sensor HmIP-SFD | Air quality sensor with PM2.5 and PM10 + temperature and humidity | |
| Floor heating actuators HmIP-FAL, FALMOT | Control them through the room's wall thermostat or heating group | The actuator itself only shows valve data in the Eve app |

## Windows, doors and shading

| Devices | In Apple Home | Notes |
|---|---|---|
| Window/door contacts HmIP-SWDO, SWDO-I, SWDO-PL, SWDM, SCI, FCI1, HM-Sec-SC, HM-Sec-SCo, HM-SCI-3-FM, HMW-Sen-SC-12 | Contact sensor | Tilted counts as open; tamper and battery where the device reports them |
| Window handles HmIP-SRH, HM-Sec-RHS | Contact sensor | Optionally as a window with 0/50/100 % |
| Roller shutters HmIP-BROLL, FROLL, HM-LC-Bl1 | Window covering | Position, movement and stop |
| Venetian blinds HmIP-BBL, FBL, DRBLI4, HM-LC-Ja1PBU-FM, Hunter Douglas HDM | Window covering with slat tilt | |
| Window drive HmIP-MOD-WD-VK, WinMatic HM-Sec-Win | Window | Position, movement and stop |
| Garage door modules HmIP-MOD-HO, MOD-TM | Garage door opener + light | Opening/closing, stopped; the drive's light as a lightbulb |
| Door lock drive HmIP-DLD, Door Lock Drive Pro HmIP-DLP | Lock | Locked, unlocked, jammed, unknown; optional latch opening |
| Door lock sensor HmIP-DLS | Lock (read only) | |
| KeyMatic HM-Sec-Key | Lock + optional "Open" switch | Jammed on motor or clutch errors |

## Safety

| Devices | In Apple Home | Notes |
|---|---|---|
| Smoke detectors HmIP-SWSD, SWSD-2, SWSD-3, HM-Sec-SD, HM-Sec-SD-2 | Smoke sensor | Fault for a dirty chamber, failed test or lost connection |
| Water sensors HmIP-SWD, HM-Sec-WDS | Leak sensor | |
| Rain sensors HmIP-SRD, HM-Sen-RD-O | Leak sensor | Rain counts as "leak"; Apple Home has no rain sensor |
| Sirens HmIP-ASIR, ASIR-2, ASIR-O | Switch "Alarm" | Apple Home has no siren type. Switching it on sounds the siren for the configured time (default 180 s) |
| CCU alarm (HM-Sec-Sir-WM arming, variables) | Security system | |

## Lights, switches and energy

| Devices | In Apple Home | Notes |
|---|---|---|
| Dimmers HmIP-BDT, FDT, PDT, DRDI3, WUA, HM-LC-Dim | Lightbulb with brightness | |
| Colour lights HmIP-RGBW, LSC, E27, GU10 | Lightbulb with colour and white temperature | |
| RGBW controller HM-LC-RGBW-WM, dual white HM-LC-DW-WM | Lightbulb with colour or white temperature | |
| Plugs HmIP-PS, PS-2, PSM, HM-LC-Sw1-Pl, HM-ES-PMSw1-Pl | Outlet | Power and energy only in the Eve app |
| Switch actuators HmIP-BSM, FSM, FSI16, PCBS, DRSI1/4, MOD-OC8, HM-LC-Sw, HMW-IO | Switch | Can be set to Outlet, Lightbulb, Fan or Valve per channel |
| Irrigation valve HmIP-WSM | Valve (irrigation) | Run time settable in Apple Home |
| Water stop HmIP-WSS | Valve | |
| Energy sensors HmIP-ESI, HM-ES-TX-WM | Eve app only | Apple Home shows no energy values |

## Buttons and sensors

| Devices | In Apple Home | Notes |
|---|---|---|
| Remotes and wall buttons HmIP-WRC2, WRC6, BRC2, KRC4, KRCA, RC8, HM-RC, HM-PB | One accessory with numbered buttons | Short and long press for automations |
| CCU virtual keys HM-RCV-50 / HmIP-RCV-50 | Programmable switch per key | Or a switch that presses the key |
| Doorbell HmIP-DSD-PCB, HmIP-DBB, HM-Sen-DB-PCB | Doorbell with a still image | A real doorbell in Apple Home (tile, ring notification, chime); the picture of the device instead of live video. Alternatively a programmable switch |
| Motion detectors HmIP-SMI, SMO, SMI55, HM-Sec-MDIR | Motion sensor + light sensor | |
| Presence detector HmIP-SPI | Occupancy sensor + light sensor | |
| Light sensor HmIP-SLO, HM-Sen-LI-O | Light sensor | |
| Tilt/vibration sensor HmIP-SAM, HM-Sec-TiS | Contact sensor | |

## CCU objects

| Object | In Apple Home |
|---|---|
| System variables | Switch, sensor (contact, motion, leak, occupancy, smoke), number sensor or security system |
| Programs | Switch that starts the program |
| Special devices | Doorbell on any key or contact, video doorbell (camera with two-way audio), CCU temperature (not in a virtual machine), CCU duty cycle, multi-key buttons |

## What Apple Home cannot show

Apple Home has no tiles for power and energy, wind, rain amount, air pressure, fill level or sirens. HomeKit-CCU sends power, energy and weather values as Eve characteristics, so the free Eve app shows them. Apple's energy features (iOS 26) are only available for Matter devices.

A device that is missing here? Open an [issue](https://github.com/bloop16/homekit-ccu/issues/new?template=feature-request.md) with the device description from *Internals → Support*.
