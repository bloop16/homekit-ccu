/*
 * Colour theme (light, dark, automatic). Loaded in <head> so the page is painted in the
 * right theme; the choice is kept per browser in localStorage.
 */
(function () {
  const KEY = 'homekit-ccu-theme'
  const ICONS = { light: 'bi-sun', dark: 'bi-moon-stars', auto: 'bi-circle-half' }
  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const stored = () => {
    try {
      const value = window.localStorage.getItem(KEY)
      return ICONS[value] ? value : 'auto'
    } catch (e) {
      return 'auto'
    }
  }

  const resolve = (choice) => (choice === 'auto' ? (media.matches ? 'dark' : 'light') : choice)

  const apply = (choice) => {
    document.documentElement.setAttribute('data-bs-theme', resolve(choice))
    const icon = document.getElementById('themeIcon')
    if (icon) icon.className = 'bi fs-5 ' + ICONS[choice]
    document.querySelectorAll('[data-theme-value]').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-theme-value') === choice)
    })
    document.dispatchEvent(new CustomEvent('hkccu:themechange'))
  }

  apply(stored())
  media.addEventListener('change', () => { if (stored() === 'auto') apply('auto') })

  document.addEventListener('DOMContentLoaded', () => {
    apply(stored())
    document.querySelectorAll('[data-theme-value]').forEach(el => {
      el.addEventListener('click', () => {
        const choice = el.getAttribute('data-theme-value')
        try { window.localStorage.setItem(KEY, choice) } catch (e) { /* private mode: theme is not kept */ }
        apply(choice)
      })
    })
  })
})()
