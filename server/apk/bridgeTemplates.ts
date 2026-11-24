export interface BridgeConfig {
  appName: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  entryFile: string;
  enableBridge: boolean;
  enableGeolocation: boolean;
  enableCamera: boolean;
  enableStorage: boolean;
  allowMixedContent: boolean;
  handleBackButton: boolean;
  statusBarColor: string;
  bridgeMethods: string[];
}

export function generateAndroidBridgeJs(config: BridgeConfig): string {
  return `/* APKBridge Runtime — Auto-injected to connect website actions with Android WebView */
(function (global) {
  'use strict';

  var STORAGE_PREFIX = 'apkbridge_kv_';
  var isNative = typeof global.AndroidNativeBridge !== 'undefined';
  var inEmulator = global.parent && global.parent !== global;

  function emitPreviewEvent(action, payload) {
    if (inEmulator) {
      try {
        global.parent.postMessage(
          { type: 'APKBRIDGE_CALL', action: action, payload: payload, timestamp: Date.now() },
          '*'
        );
      } catch (_) {}
    }
  }

  var APKBridge = {
    isNativeAndroid: isNative,
    appName: ${JSON.stringify(config.appName)},
    packageName: ${JSON.stringify(config.packageName)},
    versionName: ${JSON.stringify(config.versionName)},

    showToast: function (message) {
      var text = String(message == null ? '' : message);
      if (isNative && typeof global.AndroidNativeBridge.showToast === 'function') {
        global.AndroidNativeBridge.showToast(text);
        return true;
      }
      emitPreviewEvent('showToast', { message: text });
      return false;
    },

    getDeviceInfo: function () {
      if (isNative && typeof global.AndroidNativeBridge.getDeviceInfo === 'function') {
        try {
          return JSON.parse(global.AndroidNativeBridge.getDeviceInfo());
        } catch (_) {}
      }
      var info = {
        platform: 'android-webview-preview',
        packageName: ${JSON.stringify(config.packageName)},
        versionName: ${JSON.stringify(config.versionName)},
        userAgent: navigator.userAgent,
        language: navigator.language
      };
      emitPreviewEvent('getDeviceInfo', info);
      return info;
    },

    vibrate: function (ms) {
      var duration = Number(ms) || 60;
      if (isNative && typeof global.AndroidNativeBridge.vibrate === 'function') {
        global.AndroidNativeBridge.vibrate(duration);
        return true;
      }
      if (navigator.vibrate) navigator.vibrate(duration);
      emitPreviewEvent('vibrate', { ms: duration });
      return true;
    },

    shareText: function (title, text) {
      if (isNative && typeof global.AndroidNativeBridge.shareText === 'function') {
        global.AndroidNativeBridge.shareText(String(title || ''), String(text || ''));
        return true;
      }
      emitPreviewEvent('shareText', { title: title, text: text });
      if (navigator.share) {
        return navigator.share({ title: title, text: text }).catch(function () {});
      }
      return false;
    },

    openExternalUrl: function (url) {
      var target = String(url || '');
      if (isNative && typeof global.AndroidNativeBridge.openExternalUrl === 'function') {
        global.AndroidNativeBridge.openExternalUrl(target);
        return true;
      }
      emitPreviewEvent('openExternalUrl', { url: target });
      return false;
    },

    writeStorage: function (key, value) {
      var k = String(key);
      var v = String(value == null ? '' : value);
      if (isNative && typeof global.AndroidNativeBridge.writeStorage === 'function') {
        global.AndroidNativeBridge.writeStorage(k, v);
        return true;
      }
      try {
        localStorage.setItem(STORAGE_PREFIX + k, v);
      } catch (_) {}
      emitPreviewEvent('writeStorage', { key: k, value: v });
      return true;
    },

    readStorage: function (key) {
      var k = String(key);
      if (isNative && typeof global.AndroidNativeBridge.readStorage === 'function') {
        return global.AndroidNativeBridge.readStorage(k);
      }
      var val = null;
      try {
        val = localStorage.getItem(STORAGE_PREFIX + k);
      } catch (_) {}
      emitPreviewEvent('readStorage', { key: k, value: val });
      return val;
    },

    setStatusBarColor: function (hexColor) {
      var color = String(hexColor || ${JSON.stringify(config.statusBarColor)});
      if (isNative && typeof global.AndroidNativeBridge.setStatusBarColor === 'function') {
        global.AndroidNativeBridge.setStatusBarColor(color);
        return true;
      }
      emitPreviewEvent('setStatusBarColor', { color: color });
      return true;
    }
  };

  global.APKBridge = APKBridge;
  global.dispatchEvent(new CustomEvent('apkbridge:ready', { detail: APKBridge }));
})(window);
`;
}

export function injectBridgeIntoHtml(html: string, bridgeRelPath: string): string {
  const scriptTag = `<script src="${bridgeRelPath}"></script>`;
  if (html.includes('android-bridge.js')) return html;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  ${scriptTag}\n</head>`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (match) => `${match}\n  ${scriptTag}`);
  }
  return `${scriptTag}\n${html}`;
}

export function generateWebAppBridgeJava(config: BridgeConfig): string {
  return `package ${config.packageName};

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import org.json.JSONObject;

public class WebAppBridge {
    private final Activity activity;
    private final SharedPreferences prefs;

    public WebAppBridge(Activity activity) {
        this.activity = activity;
        this.prefs = activity.getSharedPreferences("apkbridge_storage", Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public void showToast(final String message) {
        activity.runOnUiThread(() ->
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        );
    }

    @JavascriptInterface
    public String getDeviceInfo() {
        try {
            JSONObject info = new JSONObject();
            info.put("platform", "android");
            info.put("manufacturer", Build.MANUFACTURER);
            info.put("model", Build.MODEL);
            info.put("sdkInt", Build.VERSION.SDK_INT);
            info.put("packageName", activity.getPackageName());
            info.put("versionName", ${JSON.stringify(config.versionName)});
            return info.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void vibrate(long milliseconds) {
        Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
        if (v == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createOneShot(Math.max(10L, milliseconds), VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            v.vibrate(Math.max(10L, milliseconds));
        }
    }

    @JavascriptInterface
    public void shareText(String title, String text) {
        Intent sendIntent = new Intent(Intent.ACTION_SEND);
        sendIntent.setType("text/plain");
        sendIntent.putExtra(Intent.EXTRA_SUBJECT, title);
        sendIntent.putExtra(Intent.EXTRA_TEXT, text);
        activity.startActivity(Intent.createChooser(sendIntent, title));
    }

    @JavascriptInterface
    public void openExternalUrl(String url) {
        if (url == null || (!url.startsWith("http://") && !url.startsWith("https://"))) return;
        Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        activity.startActivity(browserIntent);
    }

    @JavascriptInterface
    public void writeStorage(String key, String value) {
        prefs.edit().putString(key, value).apply();
    }

    @JavascriptInterface
    public String readStorage(String key) {
        return prefs.getString(key, null);
    }

    @JavascriptInterface
    public void setStatusBarColor(final String hexColor) {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    activity.getWindow().setStatusBarColor(Color.parseColor(hexColor));
                }
            } catch (IllegalArgumentException ignored) {}
        });
    }
}
`;
}

export function generateMainActivityJava(config: BridgeConfig): string {
  const cleanEntry = config.entryFile.replace(/^\/+/, '') || 'index.html';
  return `package ${config.packageName};

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> fileUploadCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                getWindow().setStatusBarColor(Color.parseColor(${JSON.stringify(config.statusBarColor)}));
            } catch (IllegalArgumentException ignored) {}
        }

        webView = findViewById(R.id.bridge_webview);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setGeolocationEnabled(${config.enableGeolocation});
        ${
          config.allowMixedContent
            ? 'if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) { settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW); }'
            : ''
        }

        ${
          config.enableBridge
            ? 'webView.addJavascriptInterface(new WebAppBridge(this), "AndroidNativeBridge");'
            : '// Native JS Bridge disabled in build config'
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("file".equals(scheme) || "about".equals(scheme)) {
                    return false;
                }
                if ("tel".equals(scheme) || "mailto".equals(scheme)) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, ${config.enableGeolocation}, false);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (fileUploadCallback != null) fileUploadCallback.onReceiveValue(null);
                fileUploadCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/www/${cleanEntry}");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && fileUploadCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileUploadCallback.onReceiveValue(results);
            fileUploadCallback = null;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        ${
          config.handleBackButton
            ? 'if (webView != null && webView.canGoBack()) { webView.goBack(); return; }'
            : ''
        }
        super.onBackPressed();
    }
}
`;
}

export function generateAndroidManifestXml(config: BridgeConfig): string {
  const perms = ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.VIBRATE'];
  if (config.enableGeolocation) perms.push('android.permission.ACCESS_FINE_LOCATION');
  if (config.enableCamera) perms.push('android.permission.CAMERA');
  if (config.enableStorage) perms.push('android.permission.READ_EXTERNAL_STORAGE');

  const permLines = perms
    .map((p) => `    <uses-permission android:name="${p}" />`)
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${config.packageName}"
    android:versionCode="${config.versionCode}"
    android:versionName="${config.versionName}">

    <uses-sdk
        android:minSdkVersion="21"
        android:targetSdkVersion="34" />

${permLines}

    <application
        android:allowBackup="true"
        android:label="@string/app_name"
        android:usesCleartextTraffic="${config.allowMixedContent}"
        android:hardwareAccelerated="true">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
}

export function generateActivityMainLayout(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <WebView
        android:id="@+id/bridge_webview"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

</FrameLayout>
`;
}

export function generateStringsXml(appName: string): string {
  const safe = appName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${safe}</string>
</resources>
`;
}

export function generateAppBuildGradle(config: BridgeConfig): string {
  return `plugins {
    id 'com.android.application'
}

android {
    namespace '${config.packageName}'
    compileSdk 34

    defaultConfig {
        applicationId "${config.packageName}"
        minSdk 21
        targetSdk 34
        versionCode ${config.versionCode}
        versionName "${config.versionName}"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation 'androidx.webkit:webkit:1.10.0'
}
`;
}
