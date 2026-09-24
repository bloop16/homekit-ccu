'use strict'

/*
 * Uploaded backups are extracted with the system tar, which on the CCU is BusyBox. Not every
 * build refuses links or entries outside the target, so the archive is checked first.
 */

const childProcess = require('child_process')

const leavesTarget = (name) => name.startsWith('/') || name.split('/').includes('..')

// entries that must not be extracted: links and paths outside the target; an unreadable
// archive is reported as a single unsafe entry
function unsafeArchiveEntries (file) {
  let names
  let verbose
  try {
    names = childProcess.execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean)
    verbose = childProcess.execFileSync('tar', ['-tvzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch (e) {
    return ['(unreadable archive)']
  }
  // -tv lists the same entries in the same order; its first column starts with the entry type
  return names.filter((name, index) => {
    const line = verbose[index] || ''
    const isLink = (line[0] === 'l') || (line[0] === 'h') || / -> | link to /.test(line)
    return isLink || leavesTarget(name)
  })
}

module.exports = { unsafeArchiveEntries }
