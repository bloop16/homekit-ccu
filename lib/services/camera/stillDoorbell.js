'use strict'

/*
 * A doorbell without camera. Apple Home shows a doorbell (tile, "Cameras & Doorbells", ring
 * notification and chime) only as part of a camera; a Doorbell service on its own is "not
 * supported". So the doorbell gets hap's DoorbellController, a camera controller with the doorbell
 * as primary service, whose camera delivers a still image as snapshot and refuses live video:
 * there is no video and no ffmpeg on the CCU. Without audio options hap adds no microphone and
 * speaker.
 */

const { DoorbellController, SRTPCryptoSuites, H264Profile, H264Level, Service, Characteristic } = require('@homebridge/hap-nodejs')

const STREAMING_OPTIONS = {
  supportedCryptoSuites: [SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
  video: {
    codec: {
      profiles: [H264Profile.BASELINE, H264Profile.MAIN],
      levels: [H264Level.LEVEL3_1, H264Level.LEVEL4_0]
    },
    // the sizes Apple Home asks snapshots in (320x240 for the Apple Watch)
    resolutions: [[1920, 1080, 30], [1280, 720, 30], [640, 360, 30], [480, 270, 30], [320, 240, 15]]
  }
}

class StillImageDelegate {
  /**
   * @param {{snapshot: function(number, number): Promise<Buffer>}} stillImage JPEG per size
   * @param {string} name for the log
   * @param {object} log
   */
  constructor (stillImage, name, log) {
    this.stillImage = stillImage
    this.name = name
    this.log = log
  }

  handleSnapshotRequest (request, callback) {
    this.stillImage.snapshot(request.width, request.height).then(
      (jpg) => callback(undefined, jpg),
      (error) => {
        this.log.error('[Doorbell %s] snapshot failed: %s', this.name, error.message)
        callback(error)
      })
  }

  // no live video: refused at once, so Apple Home does not wait for a stream
  prepareStream (request, callback) {
    this.log.debug('[Doorbell %s] live video requested, this doorbell has only a still image', this.name)
    callback(new Error('this doorbell has no camera'))
  }

  handleStreamRequest (request, callback) {
    callback()
  }
}

/**
 * Makes the HomeKit accessory a doorbell with a still image.
 * @param {object} accessory hap Accessory
 * @param {object} stillImage see StillImageDelegate
 * @param {string} name
 * @param {object} log
 * @returns {{controller: object, ring: function}} ring() sends a ring to Apple Home
 */
function configureStillDoorbell (accessory, stillImage, name, log) {
  const controller = new DoorbellController({
    cameraStreamCount: 1,
    delegate: new StillImageDelegate(stillImage, name, log),
    streamingOptions: STREAMING_OPTIONS,
    name
  })
  accessory.configureController(controller)
  // a doorbell only rings: HAP knows SINGLE_PRESS alone for the Doorbell service
  const { SINGLE_PRESS } = Characteristic.ProgrammableSwitchEvent
  accessory.getService(Service.Doorbell).getCharacteristic(Characteristic.ProgrammableSwitchEvent)
    .setProps({ minValue: SINGLE_PRESS, maxValue: SINGLE_PRESS, validValues: [SINGLE_PRESS] })
  return { controller, ring: () => controller.ringDoorbell() }
}

module.exports = { configureStillDoorbell, StillImageDelegate, STREAMING_OPTIONS }
