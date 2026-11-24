import type { LanguageCode } from '../types/apk';

export const COPY = {
  en: {
    navExtract: '1. Extract APK',
    navSource: '2. Source Explorer',
    navConnect: '3. Connect Website',
    navBuild: '4. Build APK',
    ctaBuild: 'Build New APK',
    heroTitle: 'Extract APK source code, connect your website, and rebuild a signed APK.',
    heroSub:
      'Upload an Android APK or source archive to inspect its decoded manifest, Dalvik classes, and resources. Then attach a website ZIP or web files via the native WebView bridge and generate a new signed package.',
    dropApkTitle: 'Drop an Android APK or Source ZIP',
    dropApkHint: 'Supports .apk, .aab, or Android Studio .zip archives up to 1 GB',
    chooseApkBtn: 'Select APK File',
    loadSampleBtn: 'Load Sample APK',
    downloadSampleApk: 'Download Sample APK',
    downloadSampleWeb: 'Download Sample Website ZIP',
    extracting: 'Decoding manifest and DEX bytecode...',
    downloadSourceZip: 'Download Source ZIP',
    nextConnect: 'Connect Website',
    nextBuild: 'Go to Build APK',
    manifestHeading: 'Decoded AndroidManifest.xml',
    dexHeading: 'Dalvik Bytecode (DEX) Summary',
    sourceTreeHeading: 'Extracted Project Files',
    saveFile: 'Save Changes',
    savedNotice: 'Saved to workspace',
    connectTitle: 'Connect Website to APK Source',
    connectSub:
      'Upload a website ZIP (with index.html, CSS, JS) or individual web files. APKBridge wires your website into assets/www/ and connects MainActivity.java + WebAppBridge.java.',
    uploadWebZipBtn: 'Upload Website ZIP or Files',
    useSampleWebBtn: 'Use Sample Store Website',
    connectActionBtn: 'Connect Website & Wire Source',
    connecting: 'Connecting website and generating Java bridge...',
    previewHeading: 'Live Android WebView Preview',
    previewEmpty: 'Connect a website ZIP or load the sample website to preview how it runs inside the APK.',
    buildTitle: 'Rebuild & Sign New APK',
    buildSub:
      'Package your connected website assets, updated manifest metadata, and RSA-2048 JAR signature into a downloadable APK alongside the full Android Studio Gradle source.',
    buildActionBtn: 'Rebuild & Sign APK',
    building: 'Packaging assets and signing APK...',
    downloadApkBtn: 'Download Signed APK',
    downloadGradleBtn: 'Download Connected Source ZIP',
  },
  hi: {
    navExtract: '1. APK निकालें',
    navSource: '2. सोर्स कोड',
    navConnect: '3. वेबसाइट जोड़ें',
    navBuild: '4. नया APK बनाएं',
    ctaBuild: 'नया APK बनाएं',
    heroTitle: 'APK से सोर्स कोड निकालें, वेबसाइट जोड़ें और नया APK बिल्ड करें।',
    heroSub:
      'कोई भी Android APK या सोर्स ZIP अपलोड करें और उसका Manifest, DEX क्लास और रिसोर्स देखें। फिर अपनी वेबसाइट ZIP या फ़ाइलें WebView ब्रिज से जोड़कर नया Signed APK डाउनलोड करें।',
    dropApkTitle: 'Android APK या Source ZIP यहाँ डालें',
    dropApkHint: '.apk, .aab या Android Studio .zip (अधिकतम 1 GB) सपोर्टेड है',
    chooseApkBtn: 'APK फ़ाइल चुनें',
    loadSampleBtn: 'सैंपल APK लोड करें',
    downloadSampleApk: 'सैंपल APK डाउनलोड करें',
    downloadSampleWeb: 'सैंपल वेबसाइट ZIP डाउनलोड करें',
    extracting: 'Manifest और DEX कोड डिकोड हो रहा है...',
    downloadSourceZip: 'सोर्स ZIP डाउनलोड करें',
    nextConnect: 'वेबसाइट जोड़ें',
    nextBuild: 'APK बिल्ड पर जाएं',
    manifestHeading: 'डिकोड किया गया AndroidManifest.xml',
    dexHeading: 'Dalvik Bytecode (DEX) सारांश',
    sourceTreeHeading: 'निकाली गई सोर्स फ़ाइलें',
    saveFile: 'फ़ाइल सेव करें',
    savedNotice: 'बदलाव सेव हो गया',
    connectTitle: 'वेबसाइट को APK सोर्स से कनेक्ट करें',
    connectSub:
      'अपनी वेबसाइट की ZIP फ़ाइल या HTML/CSS/JS फ़ाइलें अपलोड करें। यह टूल उन्हें assets/www/ में जोड़कर MainActivity.java और WebAppBridge.java से कनेक्ट कर देगा।',
    uploadWebZipBtn: 'वेबसाइट ZIP या फ़ाइलें चुनें',
    useSampleWebBtn: 'सैंपल स्टोर वेबसाइट जोड़ें',
    connectActionBtn: 'वेबसाइट जोड़ें और सोर्स अपडेट करें',
    connecting: 'वेबसाइट और Java ब्रिज कनेक्ट हो रहा है...',
    previewHeading: 'लाइव Android WebView प्रीव्यू',
    previewEmpty: 'APK के अंदर वेबसाइट कैसी चलेगी यह देखने के लिए वेबसाइट ZIP अपलोड करें।',
    buildTitle: 'दोबारा बिल्ड करके नया Signed APK बनाएं',
    buildSub:
      'आपकी कनेक्टेड वेबसाइट फ़ाइलों और अपडेट किए गए मैनिफेस्ट के साथ नया Signed APK और पूरा Android Studio सोर्स प्रोजेक्ट तैयार करें।',
    buildActionBtn: 'नया APK बिल्ड और साइन करें',
    building: 'APK पैकेज और साइन हो रहा है...',
    downloadApkBtn: 'नया Signed APK डाउनलोड करें',
    downloadGradleBtn: 'कनेक्टेड सोर्स ZIP डाउनलोड करें',
  },
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function t(lang: LanguageCode) {
  return COPY[lang];
}
