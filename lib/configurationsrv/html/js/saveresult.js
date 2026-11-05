/*
 * The answer of the configuration service to a save request: undefined when it was saved,
 * otherwise the reason it was not (a key of the localization where there is one).
 */
export function saveFailure (result) {
  if ((result === undefined) || (result === null)) {
    return 'no answer'
  }
  if (result.result === 'saved') {
    return undefined
  }
  return result.reason || result.error || result.result || 'no answer'
}

/**
 * The reason a save failed in the language of the page; translate is the __ of a dialog. A refused
 * setting comes as "invalid setting <key>": the key stays as it is.
 */
export function failureText (translate, reason) {
  const setting = /^invalid setting (.+)$/.exec(reason)
  return setting ? translate('invalid setting') + ' ' + setting[1] : translate(reason)
}
