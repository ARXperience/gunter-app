package com.gunter.mobile

import org.junit.Assert.*
import org.junit.Test

class MobileMediaObservationTest {
    private val playing = MobileMediaSnapshot(3, "track-1", "One", "Artist")

    @Test fun existingPlayingStateCannotVerifyPause() {
        assertFalse(mediaEffectObserved("mobile.media.play_pause", playing, playing, 2))
        assertTrue(mediaEffectObserved("mobile.media.play_pause", playing, playing.copy(state = 2), 2))
    }

    @Test fun playRequiresRequestedPostDispatchState() {
        val paused = playing.copy(state = 2)
        assertFalse(mediaEffectObserved("mobile.media.play_pause", paused, paused, 3))
        assertTrue(mediaEffectObserved("mobile.media.play_pause", paused, playing, 3))
        assertFalse(mediaEffectObserved("mobile.media.play_pause", paused, playing.copy(state = null), 3))
    }

    @Test fun nextRequiresChangedIdentityNotOnlyAPlaybackState() {
        assertFalse(mediaEffectObserved("mobile.media.next", playing, playing, 3))
        assertFalse(mediaEffectObserved("mobile.media.next", playing, playing.copy(state = 2), 3))
        assertTrue(mediaEffectObserved("mobile.media.next", playing, playing.copy(mediaId = "track-2"), 3))
    }

    @Test fun nextCanUseTitleAndArtistWhenPlayerHasNoMediaId() {
        val previous = playing.copy(mediaId = null)
        assertTrue(mediaEffectObserved("mobile.media.next", previous, previous.copy(title = "Two"), 3))
        assertTrue(mediaEffectObserved("mobile.media.next", previous, previous.copy(artist = "Other artist"), 3))
        assertFalse(mediaEffectObserved("mobile.media.next", previous, previous, 3))
    }

    @Test fun missingBeforeOrAfterMetadataDoesNotInventAChangedTrack() {
        val unknown = MobileMediaSnapshot(3, null, null, null)
        assertFalse(mediaEffectObserved("mobile.media.next", unknown, playing, 3))
        assertFalse(mediaEffectObserved("mobile.media.next", playing, unknown, 3))
        assertFalse(mediaEffectObserved("mobile.media.next", unknown, unknown, 3))
        // A lazy metadata enrichment is not evidence that the requested next track ran.
        val unknownArtist = playing.copy(artist = null)
        assertFalse(mediaEffectObserved("mobile.media.next", unknownArtist, playing, 3))
    }

    @Test fun unsupportedCommandIsNeverVerifiedByThisCriterion() {
        assertFalse(mediaEffectObserved("mobile.open_app", playing, playing.copy(mediaId = "track-2"), 3))
    }
}
