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

module.exports = { buildStreamingOptions }
