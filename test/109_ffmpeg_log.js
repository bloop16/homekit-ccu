const path = require('path')
const expect = require('expect.js')
const { redact, StderrTail } = require(path.join(__dirname, '..', 'lib', 'services', 'camera', 'ffmpegLog.js'))

describe('HomeKit-CCU ffmpegLog', () => {
  it('redacts URL credentials', () => {
    expect(redact('-re -i rtsp://admin:s3cret@cam:554/stream')).to.be('-re -i rtsp://***@cam:554/stream')
    expect(redact('http://user@cam/snap.jpg and rtsp://a:b@c/d')).to.be('http://***@cam/snap.jpg and rtsp://***@c/d')
  })

  it('redacts SRTP keys', () => {
    expect(redact('-srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params AQEBAQ+/= srtp://1.2.3.4:5')).to.be('-srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params *** srtp://1.2.3.4:5')
    expect(redact('a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:AQEBAQ==')).to.be('a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:***')
  })

  it('leaves harmless text alone', () => {
    expect(redact('-f lavfi -i testsrc')).to.be('-f lavfi -i testsrc')
  })

  it('keeps the last 8 stderr lines, joined across chunks', () => {
    const tail = new StderrTail()
    tail.push('line 1\nline ')
    tail.push('2\n')
    for (let i = 3; i <= 12; i++) {
      tail.push(`line ${i}\n`)
    }
    expect(tail.text()).to.be(['line 5', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10', 'line 11', 'line 12'].join(' | '))
  })

  it('includes an unterminated last line and limits the size to about 2 KB', () => {
    const tail = new StderrTail()
    tail.push('x'.repeat(5000) + '\nlast words')
    expect(tail.text().length).to.be.below(2100)
    expect(tail.text()).to.contain('last words')
  })

  it('redacts what it keeps', () => {
    const tail = new StderrTail()
    tail.push('rtsp://admin:pw@cam/x: 401 Unauthorized\n')
    expect(tail.text()).to.be('rtsp://***@cam/x: 401 Unauthorized')
    expect(new StderrTail().text()).to.be('')
  })
})
