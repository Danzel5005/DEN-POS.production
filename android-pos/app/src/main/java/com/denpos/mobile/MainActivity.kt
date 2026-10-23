package com.denpos.mobile

import android.Manifest
import android.app.AlertDialog
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var printerStatus: TextView
    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }
    private val preferences by lazy { getSharedPreferences("den-pos", MODE_PRIVATE) }
    private val requestConnectPermission = 7101
    private val requestEnableBluetooth = 7102

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(26, 92, 56)
        window.navigationBarColor = android.graphics.Color.BLACK

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(android.graphics.Color.WHITE)
        }
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(4), dp(12), dp(4))
            setBackgroundColor(android.graphics.Color.rgb(26, 92, 56))
        }
        printerStatus = TextView(this).apply {
            setTextColor(android.graphics.Color.WHITE)
            textSize = 13f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        val selectPrinter = Button(this).apply {
            text = "Printer Bluetooth"
            isAllCaps = false
            setOnClickListener { requestPrinterSelection() }
        }
        toolbar.addView(printerStatus, LinearLayout.LayoutParams(0, dp(48), 1f))
        toolbar.addView(selectPrinter, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)))
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: android.webkit.WebResourceRequest
                ): android.webkit.WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    return !url.startsWith("https://appassets.androidplatform.net/assets/")
                }
            }
            addJavascriptInterface(AndroidPrinterBridge(this@MainActivity), "kasirAndroid")
        }
        root.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)))
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        updatePrinterStatus()
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    override fun onResume() {
        super.onResume()
        if (::printerStatus.isInitialized) updatePrinterStatus()
    }

    private fun requestPrinterSelection() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), requestConnectPermission)
            return
        }
        showPairedPrinters()
    }

    private fun showPairedPrinters() {
        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null) {
            Toast.makeText(this, "Perangkat ini tidak mendukung Bluetooth", Toast.LENGTH_LONG).show()
            return
        }
        if (!adapter.isEnabled) {
            @Suppress("DEPRECATION")
            startActivityForResult(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), requestEnableBluetooth)
            return
        }
        val devices = try {
            adapter.bondedDevices.orEmpty().sortedBy { it.name ?: it.address }
        } catch (_: SecurityException) {
            Toast.makeText(this, "Izin Bluetooth diperlukan untuk memilih printer", Toast.LENGTH_LONG).show()
            return
        }
        if (devices.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle("Printer belum dipasangkan")
                .setMessage("Pasangkan printer thermal di pengaturan Bluetooth Android, lalu pilih printer di sini.")
                .setNegativeButton("Tutup", null)
                .setPositiveButton("Pengaturan Bluetooth") { _, _ ->
                    startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                }
                .show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Pilih printer thermal")
            .setItems(devices.map { "${it.name ?: "Bluetooth"} (${it.address})" }.toTypedArray()) { _, index ->
                val device = devices[index]
                preferences.edit()
                    .putString("printer-address", device.address)
                    .putString("printer-name", device.name ?: device.address)
                    .apply()
                updatePrinterStatus()
            }
            .setNegativeButton("Batal", null)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == requestConnectPermission) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) showPairedPrinters()
            else Toast.makeText(this, "Izin Bluetooth ditolak", Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Deprecated in Android API; retained for API 24 compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == requestEnableBluetooth && resultCode == RESULT_OK) showPairedPrinters()
    }

    private fun updatePrinterStatus() {
        val name = preferences.getString("printer-name", null)
        printerStatus.text = if (name.isNullOrBlank()) "Pilih printer yang sudah dipasangkan" else "Printer: $name"
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}

class AndroidPrinterBridge(private val activity: Activity) {
    @JavascriptInterface
    fun printReceiptEscPos(payload: String): String =
        BluetoothReceiptPrinter(activity).print(payload)
}
