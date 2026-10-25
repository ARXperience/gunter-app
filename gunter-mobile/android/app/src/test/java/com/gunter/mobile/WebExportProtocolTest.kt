package com.gunter.mobile

import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class WebExportProtocolTest {
    private val id = "0123456789abcdef0123456789abcdef"
    private fun rejects(block: () -> Unit) { try { block(); fail("Expected rejection") } catch (_: IllegalArgumentException) {} }
    @Test fun knownExportsAndInferredMimeAreAccepted() {
        assertEquals("application/json", WebExportProtocol.metadata(id, "gunter-backup.json", "application/json", "12").mime)
        assertEquals("application/vnd.openxmlformats-officedocument.presentationml.presentation", WebExportProtocol.metadata(id, "deck.pptx", "application/octet-stream", "12").mime)
        assertEquals("audio/webm", WebExportProtocol.metadata(id, "audio.webm", "audio/webm;codecs=opus", "12").mime)
        assertEquals(0, WebExportProtocol.metadata(id, "empty.txt", "text/plain", "0").size)
    }
    @Test fun namesAndContentTypesAreRestricted() {
        listOf("../backup.json", "a/b.json", "a\\b.json", ".secret.json", "a\n.json", "a\u202E.json", "a.exe", "a.html", "a.js", "a.apk", "x".repeat(121) + ".json").forEach { name -> rejects { WebExportProtocol.metadata(id, name, "application/json", "1") } }
        rejects { WebExportProtocol.metadata(id, "x.json", "text/html", "1") }
        rejects { WebExportProtocol.metadata(id, "x.pdf", "application/json", "1") }
    }
    @Test fun identityAndByteCountsAreExactAndBounded() {
        listOf("-1", "1.5", "1e3", "01", "52428801", "999999999", "NaN").forEach { size -> rejects { WebExportProtocol.metadata(id, "x.json", "application/json", size) } }
        rejects { WebExportProtocol.metadata("id", "x.json", "application/json", "1") }
        assertEquals(WebExportProtocol.MAX_BYTES, WebExportProtocol.metadata(id, "x.json", "application/json", "52428800").size)
    }
    @Test fun chunksRejectOverrunAndMalformedBase64() {
        val data = Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3))
        assertArrayEquals(byteArrayOf(1, 2, 3), WebExportProtocol.decodeChunk(data, 0, 3))
        rejects { WebExportProtocol.decodeChunk(data, 1, 3) }
        listOf("", "!!!!", "YWJj\n", "a===", "YQ").forEach { chunk -> rejects { WebExportProtocol.decodeChunk(chunk, 0, 100) } }
        rejects { WebExportProtocol.decodeChunk(Base64.getEncoder().encodeToString(ByteArray(WebExportProtocol.CHUNK_BYTES + 1)), 0, WebExportProtocol.MAX_BYTES) }
    }
}
