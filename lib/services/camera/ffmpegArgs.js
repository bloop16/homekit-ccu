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

/**
 * ffmpeg argv that grabs one frame from the still image source (or the video source) as JPEG on stdout.
 * @param settings  { source, stillImageSource }
 * @param request   { width, height } from the hap SnapshotRequest
 */
function buildSnapshotArgs (settings, request) {
  // -re would only delay the single frame we need
  const input = splitInput(settings.stillImageSource || settings.source).filter(arg => arg !== '-re')
  return [
    '-hide_banner', '-loglevel', 'error',
    ...input,
    '-frames:v', '1',
    '-filter:v', `${scaleFilter(request.width, request.height)}:force_original_aspect_ratio=decrease`,
    '-f', 'image2', '-'
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
    '-b:v', `${bitrate}k`,
    '-bufsize', `${2 * bitrate}k`,
    '-maxrate', `${bitrate}k`,
    '-g', String(fps * 2)
  ]
}

function audioEncoderArgs (audio) {
  const codec = audio.codec === AudioStreamingCodecType.AAC_ELD
    ? ['-codec:a', 'libfdk_aac', '-profile:a', 'aac_eld']
    : ['-codec:a', 'libopus', '-application', 'lowdelay', '-frame_duration', String(audio.packet_time || 20)]
  return [
    ...codec,
    '-flags', '+global_header',
    '-ar', `${audio.sample_rate}k`,
    '-b:a', `${audio.max_bit_rate}k`,
    '-ac', String(audio.channel)
  ]
}

function srtpOutput (pt, ssrc, srtp, session, port, pktSize) {
  const address = session.addressVersion === 'ipv6' ? `[${session.address}]` : session.address
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
 * @param session   { address, addressVersion, videoPort, videoSSRC, videoSRTP, audioPort, audioSSRC, audioSRTP }
 * @param request   { video: VideoInfo, audio: AudioInfo|null }
 */
function buildStreamArgs (settings, session, request) {
  // Each RTP output carries exactly one stream, so every output deselects the other stream types.
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', ...splitInput(settings.source), '-an', '-sn', '-dn']
  args.push(...videoEncoderArgs(settings, request.video))
  args.push(...srtpOutput(request.video.pt, session.videoSSRC, session.videoSRTP, session, session.videoPort, request.video.mtu))
  if (request.audio) {
    args.push('-vn', '-sn', '-dn', ...audioEncoderArgs(request.audio))
    args.push(...srtpOutput(request.audio.pt, session.audioSSRC, session.audioSRTP, session, session.audioPort, AUDIO_PKT_SIZE))
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
    '-protocol_whitelist', 'pipe,udp,rtp,crypto',
    '-f', 'sdp',
    '-c:a', decoder,
    '-i', 'pipe:',
    '-codec:a', 'aac',
    ...returnOutput(returnTarget)
  ]
}

/**
 * A return target starting with "-" is taken as raw ffmpeg output args (e.g. "-f null -"), anything else as RTSP URL.
 */
function returnOutput (returnTarget) {
  const trimmed = String(returnTarget || '').trim()
  return trimmed.startsWith('-') ? splitInput(trimmed) : ['-f', 'rtsp', trimmed]
}

module.exports = { buildSnapshotArgs, buildStreamArgs, buildReturnAudioSdp, buildReturnAudioArgs, splitInput }
