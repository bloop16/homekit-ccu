🇬🇧 English | [🇩🇪 Deutsch](de/configuration.md)

# Using the configuration

Open the configuration with the **HomeKit** button under *Settings → Control panel → Additional software* of the CCU WebUI (logged in as administrator).

The settings page follows the language of your browser. To use another one, open the language menu in the header (next to the theme) and choose *English* or *Deutsch*; *Browser language* goes back to the default. The choice is kept per browser and reloads the page.

## Rooms: why a bridge per room

HomeKit itself knows no rooms. A bridge cannot tell Apple Home in which room a device belongs, so Apple Home puts a **new device into the room of its bridge**. If your bridge sits in the "Default Room", every new device lands there.

- Put the bridge itself into a room in Apple Home: tap the bridge, then *Settings → Room*. New devices of this bridge land there from then on.
- With **one bridge per CCU room** every device lands in its room right away. The setup assistant creates these bridges for you.
- Renaming a device in HomeKit-CCU creates a new accessory in Apple Home (its identity comes from the name, as in hap-homematic). It lands in the room of its bridge again.

## Setup assistant

The first entry of the menu. On a new installation it starts by itself.

1. **Layout:** one bridge per room (recommended), per floor, or one for everything.
   - Optionally put rooms with only a few devices on one shared bridge.
   - Optionally put locks, alarm and sirens on a bridge of their own.
   - Tick the CCU functions (Gewerke) whose devices you want in Apple Home.
2. **Bridges and rooms:** rename the new bridges, remove proposed ones or add bridges of your own (with floors: further floors), then choose the bridge of every room, or "not taken". Every bridge needs a name of its own. A room that already has its bridge keeps it.
3. **Devices:** every device and channel can be ticked, named and set to the type it has in Apple Home (for example switch, outlet or light). Each device has a *Bridge* field: it starts with the bridge of its room and can be changed; the device then moves to that bridge's section ("differs from the room"). Devices set to "not taken" are listed at the end and can be brought back. Search, device pictures and the switch for additional channels work as in "New device".
4. **Preview:** bridges with their rooms, devices and accessories. Apple Home takes at most 149 accessories per bridge; the assistant warns before that.
5. **Pair:** the new bridges start without devices. Add each one in Apple Home (+, *Add Accessory*, scan the code) and choose the room shown. The state changes to "paired" by itself. Then *Publish devices*: the devices land in the room of their bridge.
   - **Create the rooms in Apple Home first** (+, *Add Room*). While adding a bridge, Apple Home only offers existing rooms and its own suggestions; a new name cannot be typed there. This is Apple Home, not the bridge: HomeKit has no way for a bridge to name a room.
   - Saving the configuration only restarts bridges whose name, setup code or HomeKit id changed, and a bridge whose pairing is reset. The others keep running, so a pairing that is going on is not interrupted.

Devices that are already in HomeKit are never moved to another bridge; otherwise Apple Home would lose their room, scenes and automations.

## New device

*Devices → New* lists your CCU devices, not single channels:

- Search across device, channel, room and serial number; filters for room, function, kind of device and radio system.
- Every device shows its picture from the CCU WebUI.
- Devices already in HomeKit, the second and third virtual channel of HomematicIP outputs and the virtual CCU keys (HM-RCV-50, HmIP-RCV-50) are hidden until you switch them on.
- Ticking a device selects its useful channels. The keys of a remote are one row: one accessory with a button per key, or one accessory per key.
- The second step sets name, type in Apple Home and bridge for all chosen channels at once. Further settings are in the device list under *Edit*.

**Several switch outputs as one device:** for a device with two or more switch outputs (for example HmIP-DRSI4, HmIP-BS2, HMW-IO-12) the second step offers "One device in Apple Home with N switches". All switches then share one room; Apple Home can still show them as separate tiles. Separate devices can each have their own room. This option is off by default.

## CCU groups

Groups of the CCU (*Settings → Groups*, devices with the address `INT…`, e.g. HmIP heating groups) are shown above their member devices, in the setup assistant and in "New device". The group sets its members, so ticking the group deselects what it controls there (e.g. the thermostat of a radiator in a heating group); other functions of a member, such as a window contact, stay as they are. Everything can still be ticked by hand. The group gets its bridge like any other device.

HomeKit-CCU reads the members from the group management of the CCU (`groups.gson`). In remote mode this file is not available and groups are shown without their members.

## Special devices

*Special devices → New* first asks for the kind: doorbell, video doorbell, garage door from sensors and actors, window from rotary handle and contact, several keys as one device, CCU temperature or CCU duty cycle. CCU temperature is only offered where the system has one: a virtual machine (OVA, Proxmox) has none, the system page of the CCU shows "n/a" there as well. The duty cycle is that of the radio module, from BidCos-RF and HmIP-RF like on the system page of the CCU. The form then shows only the settings of this kind; rarely needed ones (ffmpeg, video size, actor delays) are under *Show advanced settings*. The name of a special device must be unique.

## Doorbells

Apple Home shows a doorbell only as part of a camera; a doorbell on its own is "Not Supported". A doorbell of HomeKit-CCU therefore has a camera that shows a still image: Apple Home lists it under *Cameras & Doorbells*, notifies a ring with the picture and plays the chime on a HomePod. Tapping the tile shows a crossed out camera, there is no live video, unless *Picture as live video* is switched on in the settings of the doorbell: then the tile shows the picture as live video. homekit-ccu sends it as an H.264 stream it makes itself, without ffmpeg. The stream is at most 640x480 and carries the picture uncompressed, so it is sent in full only every few seconds (as often as the bit rate Apple Home asks for allows) and the frames between only repeat it; on a slow remote connection the picture may take some seconds to appear.

- **HmIP-DSD-PCB, HmIP-DBB, HM-Sen-DB-PCB** are added as doorbell; the other choice is a programmable switch for automations. The HmIP-DSD-PCB rings on a key press (its factory setting "Taster"); when its channel is set to switch or contact mode in the CCU, it rings when the bell voltage appears.
- **Any other key or contact** becomes a doorbell with *Special devices → New → Doorbell*: choose the datapoint that rings, a key press (`PRESS_SHORT`) or a state (`STATE`) that becomes active.
- **Picture:** the picture of the device in the CCU; instead a URL (for example the snapshot of a camera) or a PNG/JPEG file on the CCU. *Upload picture* next to the field stores a PNG or JPEG (10 MB at most) with the configuration, so the backup has it, and selects it. A URL may redirect (up to 5 times, never from https to http). If it cannot be loaded, the picture of the device is shown, otherwise a plain image; the reason is written to the log once, and a picture that could not be read is tried again (after the refresh time, at the latest every minute).
- **A camera picture that is replaced** (a URL or file with the snapshot a camera stores, e.g. an n8n webhook that returns the last snapshot): *Read the picture again after* (default 10 seconds) reads it again when Apple Home asks for the picture, at most that often, in the background; a changed picture is shown from then on, also by a live video that is running (*Picture as live video*). Only what is stored is read, no camera is woken. A URL may contain a user and password (`https://user:password@host/…`, basic auth). Camera pictures fill the tile; 0 reads the picture once.
- Rings closer than 3 seconds count once.
- With a camera at the door use the video doorbell (special device), it needs ffmpeg.

## Reset

*Internals → Reset HomeKit-CCU* deletes the whole configuration after a question: all HomeKit instances, devices, variables, programs and settings, the cached data of the CCU and the HomeKit pairing of all instances. HomeKit-CCU stops for that, starts again as after a new installation, and the page loads again once it is back. Remove the bridges of HomeKit-CCU from the Home app first and add them again afterwards; create a backup first (*Internals → Backup*) if you may want the configuration back. The ffmpeg installed for the video doorbell stays.

Over SSH the same is `/usr/local/etc/config/rc.d/homekit-ccu reset`. Uninstalling the add-on also deletes the configuration, but uploading the add-on again without uninstalling it first is an update and keeps it.
