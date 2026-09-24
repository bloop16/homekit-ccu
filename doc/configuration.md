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

*Special devices → New* first asks for the kind: video doorbell, garage door from sensors and actors, window from rotary handle and contact, several keys as one device, HTTP switch, CCU temperature or CCU duty cycle. The form then shows only the settings of this kind; rarely needed ones (ffmpeg, video size, actor delays) are under *Show advanced settings*. The name of a special device must be unique.

## Doorbell buttons

Apple Home shows a doorbell without a camera as "Not Supported". HmIP-DSD-PCB, HmIP-DBB and HM-Sen-DB-PCB are therefore added as a programmable switch: a ring can start automations. For a doorbell notification with picture use the video doorbell (special device).
