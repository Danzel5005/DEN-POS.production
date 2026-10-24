package com.denpos.mobile

import android.Manifest
import android.app.AlertDialog
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.content.ContentValues
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.print.PrintJob
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import android.provider.MediaStore
import org.json.JSONObject
import java.io.File

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
    private val requestExcelFile = 7103
    private var receiptPrintView: WebView? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    @Volatile private var printInProgress = false
    private val printHandler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(26, 92, 56)
        window.navigationBarColor = android.graphics.Color.BLACK

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(android.graphics.Color.WHITE)
        }
        // Toolbar ramping: status printer + tombol pengaturan. Header web
        // (Header.jsx) sudah responsif — toolbar native hanya pelengkap status.
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(2), dp(10), dp(2))
            setBackgroundColor(android.graphics.Color.rgb(26, 92, 56))
        }
        printerStatus = TextView(this).apply {
            setTextColor(android.graphics.Color.WHITE)
            textSize = 12f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        val openSettings = Button(this).apply {
            text = "⚙ Pengaturan"
            isAllCaps = false
            textSize = 12f
            setBackgroundColor(android.graphics.Color.argb(40, 255, 255, 255))
            setTextColor(android.graphics.Color.WHITE)
            setOnClickListener {
                webView.evaluateJavascript("window.dispatchEvent(new Event('denpos-open-settings'))", null)
            }
        }
        toolbar.addView(printerStatus, LinearLayout.LayoutParams(0, dp(40), 1f))
        toolbar.addView(openSettings, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36)))
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = true
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: WebChromeClient.FileChooserParams
                ): Boolean {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = callback
                    val chooser = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            "application/vnd.ms-excel"
                        ))
                    }
                    return try {
                        startActivityForResult(Intent.createChooser(chooser, "Pilih file Excel"), requestExcelFile)
                        true
                    } catch (_: android.content.ActivityNotFoundException) {
                        fileChooserCallback = null
                        callback.onReceiveValue(null)
                        false
                    }
                }
            }
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
        root.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)))
        val webContainer = FrameLayout(this)
        webContainer.addView(webView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ))
        root.addView(webContainer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
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
                    .putString("print-mode", "bluetooth")
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
        if (requestCode == requestExcelFile) {
            val result = if (resultCode == RESULT_OK) data?.data?.let { arrayOf(it) } else null
            fileChooserCallback?.onReceiveValue(result)
            fileChooserCallback = null
        }
    }

    private fun updatePrinterStatus() {
        val name = preferences.getString("printer-name", null)
        val mode = preferences.getString("print-mode", "bluetooth")
        printerStatus.text = when {
            mode == "pdf" -> "Mode cetak: PDF"
            name.isNullOrBlank() -> "Printer belum dipilih — buka Pengaturan"
            else -> "Printer: $name"
        }
    }

    // pickPrinter — dipanggil dari JS (SettingsModal): sama dengan tombol toolbar.
    // "mode:pdf" mengaktifkan mode PDF tanpa dialog pemilihan printer.
    fun pickPrinter(mode: String): String {
        if (mode == "pdf") {
            preferences.edit().putString("print-mode", "pdf").apply()
            updatePrinterStatus()
            return resultOk("Mode PDF aktif")
        }
        runOnUiThread { requestPrinterSelection() }
        return resultOk("Pilih printer pada dialog yang muncul")
    }

    // printReceiptPdf — jalur cetak PDF: buka dialog cetak Android (Print
    // Manager) dengan HTML struk. Pengguna bisa memilih "Save as PDF" atau
    // printer sistem manapun. EscPos tetap lewat BluetoothReceiptPrinter.
    @Synchronized
    fun printReceiptPdf(html: String): String {
        val printManager = getSystemService(PRINT_SERVICE) as? android.print.PrintManager
            ?: return JSONObject().put("ok", false).put("error", "Layanan cetak tidak tersedia").toString()
        if (printInProgress) {
            return JSONObject().put("ok", false).put("error", "Cetak sebelumnya masih diproses").toString()
        }
        printInProgress = true
        runOnUiThread {
            val printView = WebView(this).apply {
                settings.javaScriptEnabled = false
                settings.domStorageEnabled = false
                isClickable = false
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            }
            receiptPrintView = printView
            val parent = webView.parent as ViewGroup
            parent.addView(printView, 0, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            ))
            printView.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    if (view !== receiptPrintView) return
                    try {
                        val job = printManager.print(
                            "DEN POS Resi",
                            printView.createPrintDocumentAdapter("den-pos-resi"),
                            android.print.PrintAttributes.Builder().build()
                        )
                        monitorPrintJob(job, printView)
                    } catch (_: Exception) {
                        printInProgress = false
                        Toast.makeText(this@MainActivity, "Gagal membuka dialog cetak", Toast.LENGTH_LONG).show()
                        releasePrintView(printView)
                    }
                }
            }
            printView.loadDataWithBaseURL(
                "https://appassets.androidplatform.net/assets/www/",
                html,
                "text/html",
                "UTF-8",
                null
            )
        }
        return resultOk("Dialog cetak dibuka")
    }

    fun saveCSV(filename: String, content: String): String {
        val safeName = filename.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
            .ifBlank { "export.csv" }
        return try {
            val path: String
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                    put(MediaStore.MediaColumns.MIME_TYPE, "text/csv")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/DEN POS")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return JSONObject().put("ok", false).put("error", "Tidak dapat membuat file unduhan").toString()
                try {
                    contentResolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use {
                        it.write("\uFEFF")
                        it.write(content)
                    } ?: throw IllegalStateException("Tidak dapat menulis file unduhan")
                    contentResolver.update(uri, ContentValues().apply {
                        put(MediaStore.MediaColumns.IS_PENDING, 0)
                    }, null, null)
                } catch (error: Exception) {
                    contentResolver.delete(uri, null, null)
                    throw error
                }
                path = "${Environment.DIRECTORY_DOWNLOADS}/DEN POS/$safeName"
            } else {
                val directory = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    ?: throw IllegalStateException("Folder unduhan tidak tersedia")
                File(directory, safeName).writeText("\uFEFF$content", Charsets.UTF_8)
                path = "${directory.absolutePath}/$safeName"
            }
            JSONObject().put("ok", true).put("path", path).toString()
        } catch (error: Exception) {
            JSONObject().put("ok", false).put("error", error.message ?: "Gagal menyimpan CSV").toString()
        }
    }

    private fun monitorPrintJob(job: PrintJob, printView: WebView) {
        if (receiptPrintView !== printView) return
        if (job.isCompleted || job.isCancelled || job.isFailed) {
            releasePrintView(printView)
            return
        }
        printHandler.postDelayed({ monitorPrintJob(job, printView) }, 500)
    }

    private fun releasePrintView(printView: WebView) {
        if (receiptPrintView !== printView) return
        (printView.parent as? ViewGroup)?.removeView(printView)
        printView.stopLoading()
        printView.destroy()
        receiptPrintView = null
        printInProgress = false
    }

    override fun onDestroy() {
        printHandler.removeCallbacksAndMessages(null)
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        receiptPrintView?.let(::releasePrintView)
        super.onDestroy()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun resultOk(message: String): String =
        JSONObject().put("ok", true).put("message", message).toString()
}

class AndroidPrinterBridge(private val activity: Activity) {
    @JavascriptInterface
    fun printReceiptEscPos(payload: String): String {
        val mode = activity.getSharedPreferences("den-pos", Activity.MODE_PRIVATE)
            .getString("print-mode", "bluetooth")
        if (mode == "pdf") {
            // Mode PDF: renderer HTML struk di sisi JS mengirim HTML-nya sendiri
            // lewat printReceiptPdf; di sini cukup sinyalkan agar JS memakai jalur PDF.
            return JSONObject().put("ok", false).put("usePdf", true)
                .put("error", "PDF_MODE").toString()
        }
        return BluetoothReceiptPrinter(activity).print(payload)
    }

    @JavascriptInterface
    fun pickPrinter(mode: String): String = (activity as? MainActivity)?.pickPrinter(mode)
        ?: JSONObject().put("ok", false).put("error", "Activity tidak tersedia").toString()

    @JavascriptInterface
    fun printReceiptPdf(html: String): String = (activity as? MainActivity)?.printReceiptPdf(html)
        ?: JSONObject().put("ok", false).put("error", "Activity tidak tersedia").toString()

    @JavascriptInterface
    fun saveCSV(filename: String, content: String): String = (activity as? MainActivity)?.saveCSV(filename, content)
        ?: JSONObject().put("ok", false).put("error", "Activity tidak tersedia").toString()

    @JavascriptInterface
    fun getPrintMode(): String =
        activity.getSharedPreferences("den-pos", Activity.MODE_PRIVATE)
            .getString("print-mode", "bluetooth") ?: "bluetooth"
}
