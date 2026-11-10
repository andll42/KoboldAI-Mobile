/* KOBOLD_LITE_LIVE_NARRATION_PATCH v1.0.0
 * Adds opt-in sentence-level live narration while streamed LLM text is arriving.
 * Uses Lite's existing audio TTS providers and the existing chunked playback queue.
 * Safe fallback: hidden-thought, dialog-only and embedded narration modes keep upstream behavior.
 */
(function installKoboldLiteLiveNarration() {
    "use strict";

    if (window.__koboldLiteLiveNarrationInstalled) return;
    window.__koboldLiteLiveNarrationInstalled = true;

    if (typeof localsettings !== "object" || typeof defaultsettings !== "object") {
        console.warn("Live Narration: Lite settings are unavailable; patch was not activated.");
        return;
    }

    const LIVE_TTS_PATCH_MARKER = "KOBOLD_LITE_LIVE_NARRATION_PATCH v1.0.0";
    // Upstream Lite TTS mode IDs: 1=browser, 2=KoboldCpp, 3=XTTS, 4=AllTalk, 5=OpenAI-compatible.
    // Use numeric IDs because upstream declares the named IDs with `const` in a separate script block.
    const STREAM_TTS_MODES = [2, 3, 4, 5];

    localsettings.tts_live_narration = !!localsettings.tts_live_narration;
    defaultsettings.tts_live_narration = false;
    // Keep this field in Lite's ordinary settings persistence so the user's choice survives app restarts.
    const state = {
        epoch: 0,
        active: false,
        finalizing: false,
        finalized: false,
        sessionOpen: false,
        lastSnapshot: "",
        carry: "",
        spokenSentences: [],
        requestEpoch: null,
        statusReason: ""
    };

    let guardedQueue = null;

    function getLiveModeReason() {
        if (!localsettings.tts_live_narration) return "Live Narration is disabled.";
        if (!localsettings.tts_mode || !STREAM_TTS_MODES.some(mode => localsettings.tts_mode == mode)) {
            return "Live Narration requires XTTS, AllTalk, OpenAI-compatible TTS or KoboldCpp TTS. The current TTS provider will use normal narration.";
        }
        if (localsettings.embed_narrations) {
            return "Live Narration is paused while Save/Embed Narrations is enabled. Normal narration remains available.";
        }
        if (localsettings.narrate_only_dialog) {
            return "Live Narration is paused while Narrate only dialog is enabled, to preserve the original quote filtering.";
        }
        if ((Number(localsettings.thinking_action) === 1 || Number(localsettings.thinking_action) === 2)
            && typeof get_thinking_regex === "function" && get_thinking_regex() !== "") {
            return "Live Narration is paused while hidden-thinking filtering is active, to prevent hidden text from being spoken.";
        }
        if (Number(localsettings.narrate_targets || 0) === 0) {
            return "Narration is disabled for all turns.";
        }
        return "";
    }

    function normalizeForCompare(text) {
        return String(text || "")
            .replace(/[\u00A0\t\r\n ]+/g, " ")
            .trim();
    }

    // Split only after sentence punctuation followed by whitespace. This avoids
    // emitting a sentence merely because a partial token currently ends in '.'
    // and preserves closing quotes/brackets with the sentence.
    function takeCompleteSentences(input) {
        const text = String(input || "");
        const chunks = [];
        const boundary = /[.!?。！？…]+["'’”»)\]\}\]]*(?=\s)/gu;
        // The boundary is immediately before whitespace; exact source slices are retained.
        let cursor = 0;
        let match;
        while ((match = boundary.exec(text)) !== null) {
            const end = match.index + match[0].length;
            const sentence = text.slice(cursor, end).trim();
            if (sentence) chunks.push(sentence);
            cursor = match.index + match[0].length;
            while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
            boundary.lastIndex = cursor;
        }
        return { chunks, remainder: text.slice(cursor) };
    }

    function installOutputQueueGuard() {
        if (!Array.isArray(tts_speak_output_queue)) return;
        if (guardedQueue === tts_speak_output_queue) return;

        const queue = tts_speak_output_queue;
        const originalPush = queue.push;
        queue.push = function (...items) {
            if (state.requestEpoch !== null) {
                const requestEpoch = state.requestEpoch;
                state.requestEpoch = null;
                if (requestEpoch !== state.epoch) {
                    console.info("Live Narration: discarded audio returned after Stop/Retry.");
                    return this.length;
                }
            }
            return originalPush.apply(this, items);
        };
        guardedQueue = queue;
    }

    function stopCurrentPlayback() {
        try {
            if (ttsMasterGain && ttsAudioContext) {
                ttsMasterGain.disconnect();
                ttsMasterGain = ttsAudioContext.createGain();
                ttsMasterGain.connect(ttsAudioContext.destination);
            }
        } catch (error) {
            console.warn("Live Narration: could not stop the current audio node cleanly.", error);
        }
        try { tts_is_playing = false; } catch (_) {}
        try { update_submit_button(false); } catch (_) {}
    }

    function clearLiveQueues(stopPlayback) {
        if (Array.isArray(tts_speak_input_queue)) tts_speak_input_queue.length = 0;
        if (Array.isArray(tts_speak_output_queue)) tts_speak_output_queue.length = 0;
        try { tts_queue_embed = false; } catch (_) {}
        try { tts_queue_download = false; } catch (_) {}
        if (stopPlayback) stopCurrentPlayback();
    }

    function resetLiveState(clearQueues, stopPlayback) {
        state.epoch++;
        state.active = false;
        state.finalizing = false;
        state.finalized = false;
        state.sessionOpen = false;
        state.lastSnapshot = "";
        state.carry = "";
        state.spokenSentences = [];
        // Do not clear requestEpoch here. If an older fetch is still in flight,
        // its captured epoch must remain available to the output-queue guard.
        if (clearQueues) clearLiveQueues(!!stopPlayback);
        installOutputQueueGuard();
    }

    function beginLiveSession() {
        if (state.sessionOpen || state.finalized) {
            resetLiveState(true, true);
        }
        state.active = true;
        state.finalizing = false;
        state.finalized = false;
        state.sessionOpen = true;
        state.lastSnapshot = "";
        state.carry = "";
        state.spokenSentences = [];
        try { tts_queue_embed = false; } catch (_) {}
        try { tts_queue_download = false; } catch (_) {}
        installOutputQueueGuard();
        console.info("Live Narration: started for the current streamed response.");
    }

    function enqueueSentence(sentence) {
        let clean = String(sentence || "").trim();
        if (typeof strip_tts_media_placeholders === "function") {
            clean = strip_tts_media_placeholders(clean);
        }
        clean = clean.trim();
        if (!clean) return;
        if (!Array.isArray(tts_speak_input_queue)) {
            console.warn("Live Narration: upstream TTS input queue is unavailable.");
            return;
        }
        tts_queue_embed = false;
        tts_queue_download = false;
        tts_speak_input_queue.push(clean);
        state.spokenSentences.push(clean);
    }

    function enqueueCompleteSentences(text, flushTail) {
        const result = takeCompleteSentences(text);
        result.chunks.forEach(enqueueSentence);
        state.carry = result.remainder;
        if (flushTail && state.carry.trim()) {
            enqueueSentence(state.carry);
            state.carry = "";
        }
    }

    function updateFromStream(fullText) {
        const current = String(fullText || "");
        if (!current) return;
        if (state.finalizing) return;

        // A completed response leaves its TTS queue alive while audio plays.
        // When a different cumulative stream appears, re-arm Live Narration for
        // the next generation and stop/clear the previous response queue exactly
        // as upstream tts_speak() would do when a new narrated turn begins.
        if (state.finalized) {
            if (current === state.lastSnapshot) return;
            console.info("Live Narration: new generation detected after a completed response.");
            resetLiveState(true, true);
        }

        if (!state.active) {
            if (getLiveModeReason()) return;
            beginLiveSession();
        }

        // All reviewed Lite streaming paths expose a cumulative string in
        // synchro_pending_stream. If it shrinks or is replaced, treat this as a
        // new generation (Retry/new response), not as a delta of the old one.
        if (state.lastSnapshot && !current.startsWith(state.lastSnapshot)) {
            console.info("Live Narration: detected a new/replaced stream; clearing the previous pending queue.");
            resetLiveState(true, true);
            if (getLiveModeReason()) return;
            beginLiveSession();
        }

        if (current === state.lastSnapshot) return;
        const delta = current.startsWith(state.lastSnapshot)
            ? current.slice(state.lastSnapshot.length)
            : current;
        state.lastSnapshot = current;
        state.carry += delta;
        enqueueCompleteSentences(state.carry, false);
    }

    function finishLiveSession(finalText) {
        if (!state.active || state.finalized) return;
        const finalClean = typeof strip_tts_media_placeholders === "function"
            ? strip_tts_media_placeholders(String(finalText || ""))
            : String(finalText || "");
        const finalNormalized = normalizeForCompare(finalClean);
        const spokenNormalized = normalizeForCompare(state.spokenSentences.join(" "));
        let remainder = "";

        if (!spokenNormalized) {
            remainder = finalNormalized;
        } else if (finalNormalized.startsWith(spokenNormalized)) {
            remainder = finalNormalized.slice(spokenNormalized.length).trim();
        } else {
            const spokenAt = finalNormalized.indexOf(spokenNormalized);
            if (spokenAt >= 0) {
                // A pre/post-injected context fragment may surround the streamed
                // response. Do not replay the part already spoken.
                remainder = (finalNormalized.slice(0, spokenAt) + " " + finalNormalized.slice(spokenAt + spokenNormalized.length)).trim();
            } else if (spokenNormalized.startsWith(finalNormalized)) {
                // Upstream final trimming removed text that had already been queued.
                remainder = "";
            } else {
                // Never replay the whole answer: that would duplicate speech.
                console.warn("Live Narration: final text does not match the spoken stream prefix; skipping final flush to avoid duplicate narration.");
                remainder = "";
            }
        }

        state.carry = "";
        enqueueCompleteSentences(remainder, true);
        state.active = false;
        state.finalized = true;
        state.finalizing = false;
        state.sessionOpen = true;
        console.info("Live Narration: generation finished; remaining text was queued.");
    }

    function maybeCloseSessionAfterPlayback() {
        if (!state.sessionOpen || !state.finalized) return;
        const inputEmpty = !Array.isArray(tts_speak_input_queue) || tts_speak_input_queue.length === 0;
        const outputEmpty = !Array.isArray(tts_speak_output_queue) || tts_speak_output_queue.length === 0;
        if (inputEmpty && outputEmpty && !tts_is_processing && !tts_is_playing) {
            state.sessionOpen = false;
            state.spokenSentences = [];
        }
    }

    function insertLiveNarrationSettingsUI() {
        let row = document.getElementById("live_narration_row");
        if (!row) {
            const anchor = document.getElementById("narratestreamingdiv")
                || document.getElementById("tts_stream")?.closest(".settinglabel");
            if (!anchor) {
                console.warn("Live Narration: could not find the Audio Output/Narration streaming settings anchor.");
                return;
            }
            anchor.insertAdjacentHTML("afterend", `
                <div class="settinglabel" id="live_narration_row">
                    <div class="justifyleft">Live Narration
                        <span class="helpicon">?<span class="helptext">Start TTS while the LLM is still generating. Complete sentences are sent to the existing audio TTS queue as soon as they arrive. Supports XTTS, AllTalk, OpenAI-compatible TTS and KoboldCpp TTS. The existing Narration streaming option remains unchanged.</span></span>
                    </div>
                    <div class="push-right">
                        <input title="Live Narration during LLM generation" type="checkbox" id="tts_live_narration">
                    </div>
                </div>
                <div class="menutext" id="live_narration_info" style="font-size:0.9em">
                    Live Narration uses sentence boundaries. It falls back to normal narration when hidden-thinking filtering, Narrate only dialog, or Save/Embed Narrations is enabled. Browser-only TTS is not supported by this live queue.
                </div>
            `);
            row = document.getElementById("live_narration_row");
        }
        const checkbox = document.getElementById("tts_live_narration");
        if (checkbox) checkbox.checked = !!localsettings.tts_live_narration;
        const info = document.getElementById("live_narration_info");
        if (info) {
            const reason = getLiveModeReason();
            info.textContent = reason || "Ready. Live Narration will begin when the first streamed sentence is complete.";
            info.style.color = reason && localsettings.tts_live_narration ? "#b8860b" : "";
        }
    }

    // Add the setting to Lite's normal UI and save it through Lite's existing
    // localsettings persistence as an ordinary UI preference.
    const previousDisplaySettings = display_settings;
    display_settings = function (...args) {
        const result = previousDisplaySettings.apply(this, args);
        insertLiveNarrationSettingsUI();
        return result;
    };

    const previousConfirmSettings = confirm_settings;
    confirm_settings = function (...args) {
        const checkbox = document.getElementById("tts_live_narration");
        if (checkbox) localsettings.tts_live_narration = !!checkbox.checked;
        const result = previousConfirmSettings.apply(this, args);
        insertLiveNarrationSettingsUI();
        return result;
    };


    // The normal Send button reaches prepare_submit_generation before the new
    // backend stream is opened. Rearm state there so even a new response whose
    // first text happens to match the previous answer can be narrated live.
    // Do not clear the playback queues here: audio already queued by the prior
    // response may finish in order while the next response starts producing text.
    function armForNextGeneration() {
        if (!state.finalized) return;
        state.active = false;
        state.finalizing = false;
        state.finalized = false;
        state.sessionOpen = false;
        state.lastSnapshot = "";
        state.carry = "";
        state.spokenSentences = [];
    }

    const previousPrepareSubmitGeneration = prepare_submit_generation;
    prepare_submit_generation = function (...args) {
        armForNextGeneration();
        return previousPrepareSubmitGeneration.apply(this, args);
    };

    // Capture the first render as well as normal lightweight stream updates.
    // The first SSE chunk can render the pending message before the lighter
    // update_pending_stream_displays() path is called.
    const previousUpdatePending = update_pending_stream_displays;
    update_pending_stream_displays = function (...args) {
        try { updateFromStream(synchro_pending_stream); }
        catch (error) { console.warn("Live Narration stream update failed:", error); }
        return previousUpdatePending.apply(this, args);
    };

    const previousRenderGameText = render_gametext;
    render_gametext = function (...args) {
        try {
            if (typeof synchro_pending_stream === "string" && synchro_pending_stream) {
                updateFromStream(synchro_pending_stream);
            }
        } catch (error) { console.warn("Live Narration render hook failed:", error); }
        return previousRenderGameText.apply(this, args);
    };

    // The original final handler calls tts_speak() with the fully assembled text.
    // Intercept only that synchronous final call; user-prompt narration remains intact.
    const previousTtsSpeak = tts_speak;
    tts_speak = function (text, do_download = false, do_embed_tts = false, is_test = false) {
        if (state.finalizing && state.active && !is_test) {
            finishLiveSession(text);
            return;
        }
        const result = previousTtsSpeak.apply(this, arguments);
        installOutputQueueGuard();
        return result;
    };

    const previousHandleIncomingText = handle_incoming_text;
    handle_incoming_text = function (...args) {
        if (!state.active) return previousHandleIncomingText.apply(this, args);
        state.finalizing = true;
        try {
            return previousHandleIncomingText.apply(this, args);
        } finally {
            state.finalizing = false;
            if (state.active) {
                // If the upstream handler skipped TTS (for example TTS was disabled
                // during generation), discard unsent fragments rather than speaking later.
                resetLiveState(true, false);
            }
        }
    };

    // Keep stale TTS requests from appending audio after Stop/Retry/new session.
    const previousTtsSpeakDirect = tts_speak_direct;
    tts_speak_direct = function (text, do_download = false, do_embed_tts = false, is_test = false, append_to_outqueue = false) {
        if (append_to_outqueue && state.sessionOpen) {
            state.requestEpoch = state.epoch;
            installOutputQueueGuard();
        }
        return previousTtsSpeakDirect.apply(this, arguments);
    };

    const previousPollChunkedTts = poll_chunked_tts;
    poll_chunked_tts = function (...args) {
        const result = previousPollChunkedTts.apply(this, args);
        maybeCloseSessionAfterPlayback();
        return result;
    };

    const previousAbortGeneration = abort_generation;
    abort_generation = function (...args) {
        const result = previousAbortGeneration.apply(this, args);
        resetLiveState(true, true);
        return result;
    };

    const previousRestartNewGame = restart_new_game;
    restart_new_game = function (...args) {
        const result = previousRestartNewGame.apply(this, args);
        resetLiveState(true, true);
        installOutputQueueGuard();
        return result;
    };

    // Expose small read-only diagnostics for manual testing; no network or audio
    // capture is performed by this patch itself.
    window.__koboldLiteLiveNarration = {
        marker: LIVE_TTS_PATCH_MARKER,
        getState: () => ({
            enabled: !!localsettings.tts_live_narration,
            active: state.active,
            finalized: state.finalized,
            sessionOpen: state.sessionOpen,
            queuedSentences: state.spokenSentences.length,
            pendingText: state.carry
        }),
        getModeReason: getLiveModeReason,
        takeCompleteSentences
    };

    installOutputQueueGuard();
    console.log("KoboldAI Lite Live Narration patch v1.0.0 installed.");
})();
