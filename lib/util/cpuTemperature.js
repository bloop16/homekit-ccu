'use strict'

/*
 * The CPU temperature of the machine the add-on runs on. OpenCCU reads
 * /sys/class/thermal/thermal_zone0/temp for its system page; a virtual machine (OVA, Proxmox)
 * has no thermal zone at all, x86 hardware may only have the coretemp sensor under hwmon.
 * Both report millidegrees.
 */

const fs = require('fs')
const path = require('path')

// zones and sensors of the CPU, before any other one (e.g. the ACPI zone of the board)
const CPU_ZONES = ['cpu-thermal', 'cpu_thermal', 'soc-thermal', 'x86_pkg_temp']
const CPU_SENSORS = ['coretemp', 'k10temp', 'cpu_thermal']

function readText (file) {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch (e) {
    return undefined
  }
}

function entries (dir, prefix) {
  try {
    return fs.readdirSync(dir).filter(name => name.startsWith(prefix)).sort()
  } catch (e) {
    return []
  }
}

/** the readable file among candidates [{ file, kind }], the CPU ones first; undefined if none */
function pick (candidates, cpuKinds) {
  const readable = candidates.filter(candidate => readTemperature(candidate.file) !== undefined)
  const cpu = readable.find(candidate => cpuKinds.includes(candidate.kind))
  return (cpu || readable[0] || {}).file
}

/**
 * The file with the CPU temperature: a thermal zone, else a hwmon sensor of the CPU.
 * @param {string} root sysfs root, /sys on the CCU
 * @returns {string|undefined} path of the file, undefined when the system has none
 */
function findTemperatureSource (root = '/sys') {
  const thermal = path.join(root, 'class', 'thermal')
  const zones = entries(thermal, 'thermal_zone').map(zone => ({
    file: path.join(thermal, zone, 'temp'),
    kind: readText(path.join(thermal, zone, 'type'))
  }))
  const zone = pick(zones, CPU_ZONES)
  if (zone) {
    return zone
  }
  const hwmon = path.join(root, 'class', 'hwmon')
  const sensors = entries(hwmon, 'hwmon')
    .map(sensor => ({ file: path.join(hwmon, sensor, 'temp1_input'), kind: readText(path.join(hwmon, sensor, 'name')) }))
    .filter(sensor => CPU_SENSORS.includes(sensor.kind))
  return pick(sensors, CPU_SENSORS)
}

/**
 * @param {string|undefined} file a file from findTemperatureSource
 * @returns {number|undefined} degrees Celsius with one decimal (the step of HomeKit), undefined
 *   when not readable
 */
function readTemperature (file) {
  if (!file) {
    return undefined
  }
  const milli = parseFloat(readText(file))
  return Number.isFinite(milli) ? Math.round(milli / 100) / 10 : undefined
}

module.exports = { findTemperatureSource, readTemperature }
