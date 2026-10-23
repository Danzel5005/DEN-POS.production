package com.denpos.mobile

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothSocket
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.NumberFormat
import java.util.Locale
import java.util.UUID

class BluetoothReceiptPrinter(private val activity: Activity) {
    fun print(payload: String): String {
        return try {
            val address = activity.getSharedPreferences("den-pos", Activity.MODE_PRIVATE)
                .getString("printer-address", null)
                ?: return result(false, "Pilih printer Bluetooth yang sudah dipasangkan terlebih dahulu")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
            ) return result(false, "Izin Bluetooth belum diberikan")

            val device = BluetoothAdapter.getDefaultAdapter()?.getRemoteDevice(address)
                ?: return result(false, "Bluetooth tidak tersedia di perangkat ini")
            val socket = device.createRfcommSocketToServiceRecord(
                UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
            )
            socket.use {
                it.connect()
                it.outputStream.use { output ->
                    output.write(receiptBytes(JSONObject(payload)))
                    output.flush()
                }
            }
            result(true, null)
        } catch (error: Exception) {
            result(false, error.message ?: "Gagal mengirim struk ke printer")
        }
    }

    private fun receiptBytes(data: JSONObject): ByteArray {
        val trx = data.optJSONObject("trx") ?: JSONObject()
        val width = if (data.optInt("paperWidthMm", 80) <= 58) 32 else 42
        val out = ByteArrayOutputStream()
        fun command(vararg bytes: Int) = out.write(bytes.map(Int::toByte).toByteArray())
        fun text(value: String) {
            val safe = value.replace(Regex("[^\\x20-\\x7E]"), "?")
            out.write(safe.toByteArray(Charsets.US_ASCII))
            out.write(byteArrayOf(0x0A))
        }
        fun centered(value: String) {
            command(0x1B, 0x61, 0x01)
            text(value)
            command(0x1B, 0x61, 0x00)
        }
        fun pair(label: String, value: String) {
            val suffix = value.take(width - label.length - 1)
            text(label + " ".repeat((width - label.length - suffix.length).coerceAtLeast(1)) + suffix)
        }
        fun separator() = text("-".repeat(width))
        val money = NumberFormat.getNumberInstance(Locale("id", "ID"))

        command(0x1B, 0x40, 0x1B, 0x74, 0x00)
        command(0x1B, 0x61, 0x01, 0x1B, 0x45, 0x01)
        centered(data.optString("warungName").ifBlank { trx.optString("warungName", "Warung") })
        command(0x1B, 0x45, 0x00, 0x1B, 0x61, 0x00)
        data.optString("warungAddress").takeIf(String::isNotBlank)?.let(::text)
        data.optString("warungPhone").takeIf(String::isNotBlank)?.let { text("Telp: $it") }
        val date = listOf("hari", "tgl", "bln", "thn").map { trx.optString(it) }.filter(String::isNotBlank).joinToString(" ")
        val time = listOf("jam", "mnt").map { trx.optString(it) }.filter(String::isNotBlank).joinToString(":")
        if (date.isNotBlank()) text("$date ${time.trim(':')}".trim())
        data.optString("receiptHeaderText").takeIf(String::isNotBlank)?.let(::centered)
        separator()
        pair("NO TRX", trx.optString("id"))
        pair("KASIR", data.optString("operatorName").ifBlank { trx.optString("operator", "Kasir") })
        if (data.optBoolean("customerEnabled", true) && trx.optString("customerNama").isNotBlank()) {
            val phone = trx.optString("customerTelepon")
            val customer = trx.optString("customerNama") + if (phone.isNotBlank()) " ($phone)" else ""
            pair("PELANGGAN", customer)
        }
        pair("METODE", trx.optString("metodeBayarLabel").ifBlank { trx.optString("metodeBayar") })
        separator()
        val receiptFields = data.optJSONArray("receiptAdditionals")
        if (receiptFields != null) {
            for (index in 0 until receiptFields.length()) {
                val field = receiptFields.optJSONObject(index) ?: continue
                val value = trx.optString(field.optString("key"))
                if (field.optString("category") == "receipt" && field.optBoolean("visible", true) && value.isNotBlank()) {
                    text("${field.optString("label")}: $value")
                }
            }
        }

        val items = trx.optJSONArray("items")
        if (items != null) {
            for (index in 0 until items.length()) {
                val item = items.optJSONObject(index) ?: continue
                val name = item.optString("nama", item.optString("name", "Item"))
                val qty = item.optDouble("qty", 0.0)
                val unit = item.optString("unitLabel").takeIf(String::isNotBlank)?.let { " $it" }.orEmpty()
                val price = item.optDouble("harga", 0.0)
                text("${qty.toInt()}x ${name.take(width - unit.length)}$unit")
                pair("  Rp ${money.format(price)}", "Rp ${money.format(price * qty)}")
                val extras = item.optJSONObject("additionals")
                if (extras != null) extras.keys().forEach { key ->
                    extras.optString(key).takeIf(String::isNotBlank)?.let { text("  $key: $it".take(width)) }
                }
            }
        }
        separator()
        pair("Subtotal", "Rp ${money.format(trx.optDouble("subtotal", 0.0))}")
        if (trx.optDouble("discount", 0.0) != 0.0) pair("Diskon", "Rp ${money.format(trx.optDouble("discount"))}")
        if (trx.optDouble("service", 0.0) != 0.0) pair("Service", "Rp ${money.format(trx.optDouble("service"))}")
        if (trx.optDouble("pajak", 0.0) != 0.0) pair("Pajak", "Rp ${money.format(trx.optDouble("pajak"))}")
        command(0x1B, 0x45, 0x01)
        pair("TOTAL", "Rp ${money.format(trx.optDouble("total", 0.0))}")
        command(0x1B, 0x45, 0x00)
        if (trx.optString("metodeBayar") == "cash") {
            pair("Bayar", "Rp ${money.format(trx.optDouble("bayar"))}")
            val difference = trx.optDouble("bayar") - trx.optDouble("total")
            pair(if (difference < 0) "Kurang Bayar" else "Kembalian", "Rp ${money.format(kotlin.math.abs(difference))}")
        }
        separator()
        centered("Barang yang sudah dibeli tidak bisa")
        centered("dikembalikan")
        centered(data.optString("receiptFooterText").ifBlank { "Terima kasih" })
        command(0x1B, 0x64, 0x04, 0x1D, 0x56, 0x01)
        return out.toByteArray()
    }

    private fun result(ok: Boolean, error: String?): String =
        JSONObject().put("ok", ok).put("error", error).toString()
}
