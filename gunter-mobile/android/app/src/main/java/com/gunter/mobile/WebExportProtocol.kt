package com.gunter.mobile

import java.util.Base64
import java.util.Locale

/** Narrow export protocol validation, independent of Android and storage. */
object WebExportProtocol {
    const val MAX_BYTES = 50L * 1024 * 1024
    const val CHUNK_BYTES = 24 * 1024
    const val MAX_MESSAGE_CHARS = 36000
    private val extensions = mapOf(
        "json" to "application/json", "txt" to "text/plain", "csv" to "text/csv", "ics" to "text/calendar",
        "pdf" to "application/pdf", "zip" to "application/zip", "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "webp" to "image/webp",
        "webm" to "audio/webm", "wav" to "audio/wav", "mp3" to "audio/mpeg", "ogg" to "audio/ogg", "mp4" to "video/mp4",
        "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    data class Metadata(val id: String, val name: String, val mime: String, val size: Long)

    fun metadata(id: String, name: String, mime: String, size: String): Metadata {
        require(Regex("^[a-f0-9]{32}$").matches(id)) { "invalid_export_id" }
        require(Regex("^(0|[1-9][0-9]{0,7})$").matches(size)) { "invalid_export_size" }
        val count = size.toLong()
        require(count <= MAX_BYTES) { "export_too_large" }
        require(name.isNotBlank() && name.length <= 120 && !name.startsWith('.') && name.none { it.code < 32 || it.code in 127..159 || it in "/\\:*?\"<>|" || it.code in 0x202A..0x202E || it.code in 0x2066..0x2069 }) { "invalid_export_name" }
        val extension = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        val expected = extensions[extension] ?: throw IllegalArgumentException("unsupported_export_extension")
        val supplied = mime.substringBefore(';').trim().lowercase(Locale.ROOT)
        val actual = when (supplied) { "", "application/octet-stream" -> expected; "audio/x-wav" -> "audio/wav"; else -> supplied }
        require(actual == expected || (extension == "webm" && actual == "video/webm")) { "export_mime_mismatch" }
        return Metadata(id, name, actual, count)
    }

    fun decodeChunk(data: String, received: Long, expected: Long): ByteArray {
        require(data.isNotEmpty() && data.length <= (CHUNK_BYTES / 3 * 4) && data.length % 4 == 0 && Regex("^[A-Za-z0-9+/]*={0,2}$").matches(data)) { "invalid_export_chunk" }
        val bytes = Base64.getDecoder().decode(data)
        require(bytes.isNotEmpty() && bytes.size <= CHUNK_BYTES && received >= 0 && expected in 0..MAX_BYTES && received + bytes.size <= expected) { "export_size_mismatch" }
        return bytes
    }
}
