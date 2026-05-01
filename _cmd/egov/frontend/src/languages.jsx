import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'default',
  resources: {},
  interpolation: { escapeValue: false },
  initImmediate: false,
})

// preferredLang: settings value. Falls back to browser language, then 'en'.
export async function loadLanguages(serverUrl, preferredLang = '') {
  const [langs, defaultData] = await Promise.all([
    fetch(`${serverUrl}/languages.json`).then(r => r.json()),
    fetch(`${serverUrl}/languages/default.json`).then(r => r.json()),
  ])

  i18n.addResourceBundle('default', 'translation', defaultData, true, true)

  const available = langs.map(l => l.code)
  const browserLang = navigator.language.split('-')[0]
  const candidates = [preferredLang, browserLang, 'en']
  const lng = candidates.find(c => c && available.includes(c)) ?? 'en'

  const data = await fetch(`${serverUrl}/languages/${lng}.json`).then(r => r.json())
  i18n.addResourceBundle(lng, 'translation', data, true, true)
  await i18n.changeLanguage(lng)

  return langs
}

export default i18n
