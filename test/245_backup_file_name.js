const path = require('path')
const expect = require('expect.js')
const { backupFileName } = require(path.join(__dirname, '..', 'lib', 'util', 'backupArchive.js'))

describe('HomeKit-CCU file name of a backup', () => {
  it('names the backup by year, month, day and time, with leading zeros', () => {
    expect(backupFileName(new Date(2026, 9, 31, 7, 4, 1))).to.be('homekit-ccu-backup-2026-10-31_07-04-01.tar.gz')
  })

  it('uses the local time of the CCU', () => {
    expect(backupFileName(new Date(2026, 0, 2, 23, 59, 58))).to.be('homekit-ccu-backup-2026-01-02_23-59-58.tar.gz')
  })

  it('sorts the names of backups by their time', () => {
    const dates = [
      new Date(2026, 10, 1, 0, 0, 0),
      new Date(2025, 11, 31, 23, 59, 59),
      new Date(2026, 9, 31, 7, 4, 1),
      new Date(2026, 9, 31, 17, 4, 1),
      new Date(2026, 8, 9, 10, 0, 0)
    ]
    const byName = dates.map(backupFileName).sort()
    const byTime = [...dates].sort((a, b) => a - b).map(backupFileName)
    expect(byName).to.eql(byTime)
  })
})
