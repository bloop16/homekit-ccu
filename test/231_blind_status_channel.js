'use strict'

// A blind actuator has a status channel (BLIND_TRANSMITTER) with the real level and control
// channels (BLIND_VIRTUAL_RECEIVER) with the level that was last commanded. A wall switch sets
// the control channel to 0 or 1 and stops the blind wherever it is, so only the status channel
// knows the real position (hap-homematic #552 HmIP-BBL, #649 HmIPW-DRBL4).

const path = require('path')
const expect = require('expect.js')
const { Service, Characteristic } = require('@homebridge/hap-nodejs')
const { simulateDevice, read, settle, findService } = require(path.join(__dirname, 'helpers', 'openingsHarness.js'))

const { CurrentPosition, TargetPosition } = Characteristic

const BBL = ['MAINTENANCE', 'KEY_TRANSCEIVER', 'KEY_TRANSCEIVER', 'BLIND_TRANSMITTER', 'BLIND_VIRTUAL_RECEIVER', 'BLIND_VIRTUAL_RECEIVER', 'BLIND_VIRTUAL_RECEIVER', 'BLIND_WEEK_PROFILE']
const DRBL4 = ['MAINTENANCE']
for (let blind = 0; blind < 4; blind++) {
  DRBL4.push('BLIND_TRANSMITTER', 'BLIND_VIRTUAL_RECEIVER', 'BLIND_VIRTUAL_RECEIVER', 'BLIND_VIRTUAL_RECEIVER')
}
DRBL4.push('BLIND_WEEK_PROFILE')

const blindOf = (sim) => findService(sim.accessory, Service.WindowCovering)

describe('HomeKit-CCU blind position from the status channel', () => {
  describe('HmIP-BBL (status channel 3, control channel 4)', () => {
    let sim
    before(async () => {
      sim = await simulateDevice({
        type: 'HmIP-BBL',
        address: '0001D3C99CE002',
        channels: BBL,
        channel: 4,
        service: 'HomeMaticBlindIPAccessory',
        values: { '3.LEVEL': 0.4, '4.LEVEL': 1, '3.PROCESS': 0, '4.PROCESS': 0 }
      })
    })
    after(() => sim.shutdown())

    it('shows the level of the status channel, not the one the wall switch commanded', async () => {
      expect(await read(blindOf(sim).getCharacteristic(CurrentPosition))).to.be(40)
      expect(await read(blindOf(sim).getCharacteristic(TargetPosition))).to.be(40)
    })

    it('follows the status channel, and ignores the control channel jumping to 0 or 100 %', async () => {
      sim.fire('4.LEVEL', 0)
      sim.fire('3.LEVEL', 0.65)
      await settle()
      expect(blindOf(sim).getCharacteristic(CurrentPosition).value).to.be(65)
      sim.fire('4.LEVEL', 1)
      await settle()
      expect(blindOf(sim).getCharacteristic(CurrentPosition).value).to.be(65)
      expect(sim.warnings).to.eql([])
    })
  })

  describe('HmIPW-DRBL4 (one status channel in front of its three control channels)', () => {
    const levels = { '1.LEVEL': 0.9, '5.LEVEL': 0.25, '9.LEVEL': 0.5, '13.LEVEL': 0.75, '2.LEVEL': 1, '3.LEVEL': 1, '6.LEVEL': 0, '10.LEVEL': 1, '14.LEVEL': 0 }
    const simulate = (channel) => simulateDevice({ type: 'HmIPW-DRBL4', address: '3445238272ABCD', channels: DRBL4, channel, service: 'HomeMaticBlindIPAccessory', values: levels })

    ;[[2, 90], [3, 90], [6, 25], [10, 50], [14, 75]].forEach(([channel, expected]) => {
      it('control channel ' + channel + ' shows ' + expected + ' %', async () => {
        const sim = await simulate(channel)
        try {
          expect(await read(blindOf(sim).getCharacteristic(CurrentPosition))).to.be(expected)
        } finally {
          sim.shutdown()
        }
      })
    })

    it('follows the events of its own status channel only', async () => {
      const sim = await simulate(6)
      try {
        sim.fire('1.LEVEL', 0.1)
        sim.fire('9.LEVEL', 0.2)
        sim.fire('6.LEVEL', 1)
        sim.fire('5.LEVEL', 0.8)
        await settle()
        expect(blindOf(sim).getCharacteristic(CurrentPosition).value).to.be(80)
      } finally {
        sim.shutdown()
      }
    })
  })

  describe('a blind without a status channel in front of the control channel', () => {
    it('keeps reading the level of the control channel', async () => {
      const sim = await simulateDevice({
        type: 'HmIPW-DRBL4',
        address: '3445238272ABCD',
        channels: ['MAINTENANCE', 'BLIND_VIRTUAL_RECEIVER'],
        channel: 1,
        service: 'HomeMaticBlindIPAccessory',
        values: { '1.LEVEL': 0.3 }
      })
      try {
        expect(await read(blindOf(sim).getCharacteristic(CurrentPosition))).to.be(30)
      } finally {
        sim.shutdown()
      }
    })
  })
})
