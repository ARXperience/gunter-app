package com.gunter.mobile

import org.junit.Assert.*
import org.junit.Test

class MobileSmsPolicyTest {
    @Test fun defaultsAndExplicitSmsStaySms() {
        listOf("", "   ", "sms", "SMS", " sms ").forEach { assertEquals("sms", requireSmsChannel(it)) }
    }

    @Test fun unsupportedChannelsNeverMasqueradeAsSms() {
        listOf("whatsapp", "telegram", "email", "mms", "https", "sms:123").forEach { channel ->
            try { requireSmsChannel(channel); fail("Accepted unsupported channel $channel") }
            catch (error: IllegalStateException) { assertEquals("mobile_message_channel_not_supported", error.message) }
        }
    }
}
