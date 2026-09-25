🇬🇧 English | [🇩🇪 Deutsch](de/configuration.md)

# Using the configuration

Open the configuration with the **HomeKit** button under *Settings → Control panel → Additional software* of the CCU WebUI (logged in as administrator).

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

Apple Home shows a doorbell only as part of a camera; a doorbell on its own is "Not Supported". A doorbell of HomeKit-CCU therefore has a camera that shows a still image: Apple Home lists it under *Cameras & Doorbells*, notifies a ring with the picture and plays the chime on a HomePod. Tapping the tile shows no live video, there is none.

- **HmIP-DSD-PCB, HmIP-DBB, HM-Sen-DB-PCB** are added as doorbell; the other choice is a programmable switch for automations. The HmIP-DSD-PCB rings on a key press (its factory setting "Taster"); when its channel is set to switch or contact mode in the CCU, it rings when the bell voltage appears.
- **Any other key or contact** becomes a doorbell with *Special devices → New → Doorbell*: choose the datapoint that rings, a key press (`PRESS_SHORT`) or a state (`STATE`) that becomes active.
- **Picture:** the picture of the device in the CCU; instead a URL (for example the snapshot of a camera) or a PNG/JPEG file on the CCU. If it cannot be loaded, the picture of the device is shown, otherwise a plain image.
- Rings closer than 3 seconds count once.
- With a camera at the door use the video doorbell (special device), it needs ffmpeg.
