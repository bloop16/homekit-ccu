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
      expect(a).to.contain('-an -sn -dn -codec:v libx264')
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
      expect(a).to.contain('-an -sn -dn -codec:v libx264')
      expect(a).to.contain('-vn -sn -dn -codec:a libopus -application lowdelay -flags +global_header -ar 16k -b:a 24k -ac 1 -payload_type 110 -ssrc 5678 -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ' + session.audioSRTP.toString('base64'))
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

    it('takes a return target starting with - as raw ffmpeg output args', () => {
      const a = args.buildReturnAudioArgs(' -f null - ', opusRequest).join(' ')
      expect(a).to.contain('-codec:a aac -f null -')
      expect(a).to.not.contain('rtsp')
    })

    it('uses libfdk_aac decoder for aac-eld return audio', () => {
      const a = args.buildReturnAudioArgs('rtsp://cam/talk', aacRequest).join(' ')
      expect(a).to.contain('-c:a libfdk_aac -i pipe:')
    })
  })
})
