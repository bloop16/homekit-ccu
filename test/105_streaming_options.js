const path = require('path')
const expect = require('expect.js')
const hap = require('@homebridge/hap-nodejs')
const { buildStreamingOptions } = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'streamingOptions.js'))
const { reserveUdpPort, bindUdpSocket } = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'udpPort.js'))

describe('HomeKit-CCU streamingOptions', () => {
  it('offers video with all profiles and levels', () => {
    const o = buildStreamingOptions({ encoders: new Set(), audio: false, twoWay: false })
    expect(o.supportedCryptoSuites).to.eql([hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80])
    expect(o.video.codec.profiles).to.eql([hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH])
    expect(o.video.codec.levels).to.eql([hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0])
    // expect.js contain() compares by identity, so compare the resolutions as strings
    const resolutions = o.video.resolutions.map(r => r.join('x'))
    expect(resolutions).to.contain('1920x1080x30')
    expect(resolutions).to.contain('320x180x30')
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

  it('rejects and closes the socket when the port is taken', async () => {
    const taken = await bindUdpSocket('ipv4')
    let error
    try {
      await bindUdpSocket('ipv4', taken.address().port)
    } catch (e) { error = e }
    taken.close()
    expect(error).to.be.an(Error)
    expect(error.code).to.be('EADDRINUSE')
  })
})
