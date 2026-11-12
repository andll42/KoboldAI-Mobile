/* KOBOLD_LITE_LIVE_NARRATION_PATCH v1.0.0
 * Adds sentence-level live narration while streamed LLM text is arriving.
 * Uses Lite's existing audio TTS providers and the existing chunked playback queue.
 * Thinking blocks are filtered from the live stream before text is queued for TTS.
 * Dialog-only and embedded narration modes keep upstream behavior.
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

    const state = {
        epoch: 0,
        active: false,
        finalizing: false,
        finalized: false,
        sessionOpen: false,
        lastSnapshot: "",
        lastRawSnapshot: "",
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

    // Extract the literal opening and closing tags from Lite's active thinking regex.
    // The reviewed Lite 354 expression has the form:
    // <think>((?:(?!...).)*?)</think>
    function getThinkingTagPair() {
        const action = Number(localsettings.thinking_action);
        if (action !== 1 && action !== 2) return null;
        if (typeof get_thinking_regex !== "function") return { invalid: true };

        const expression = String(get_thinking_regex() || "");
        if (!expression) return { invalid: true };

        const bodyStart = expression.indexOf("((");
        const bodyEnd = expression.lastIndexOf("*?)");
        if (bodyStart <= 0 || bodyEnd < bodyStart) return { invalid: true };

        const startTag = expression.slice(0, bodyStart);
        const endTag = expression.slice(bodyEnd + 3);
        // The current Lite tags are literal HTML-like markers (e.g. <think>).</n        // Refuse unexpected regex structures rather than risk speaking hidden text.
        if (!startTag || !endTag || startTag.length > 128 || endTag.length > 128 ||
            /[\\()[\]{}|+?*]/.test(startTag) || /[\\()[\]{}|+?*]/.test(endTag)) {
            return { invalid: true };
        }
        return { startTag, endTag };
    }

    function indexOfIgnoreCase(text, token, fromIndex) {
        return text.toLowerCase().indexOf(token.toLowerCase(), fromIndex);
    }

    function partialTagPrefixLength(text, tag) {
        const max = Math.min(text.length, tag.length - 1);
        for (let n = max; n > 0; n--) {
            if (text.slice(-n).toLowerCase() === tag.slice(0, n).toLowerCase()) return n;
        }
        return 0;
    }

    // Filter a cumulative stream. Any unfinished thinking block is hidden,
    // including partial opening/closing tags split across stream updates.
    function filterThinkingFromStream(input) {
        const text = String(input || "");
        const tags = getThinkingTagPair();
        if (tags === null) return text;
        // Fail closed if Lite's regex is not in the reviewed format.
        if (tags.invalid) return "";

        let cursor = 0;
        let visible = "";
        let insideThinking = false;

        while (cursor < text.length) {
            if (insideThinking) {
                const stopAt = indexOfIgnoreCase(text, tags.endTag, cursor);
                if (stopAt < 0) break;
                cursor = stopAt + tags.endTag.length;
                insideThinking = false;
            } else {
                const startAt = indexOfIgnoreCase(text, tags.startTag, cursor);
                if (startAt < 0) {
                    const rest = text.slice(cursor);
                    const hold = partialTagPrefixLength(rest, tags.startTag);
                    visible += rest.slice(0, rest.length - hold);
                    break;
                }
                visible += text.slice(cursor, startAt);
                cursor = startAt + tags.startTag.length;
                insideThinking = true;
            }
        }
        return visible;
    }

    // Split only after sentence punctuation followed by whitespace. This avoids
    // emitting a sentence merely because a partial token currently ends in '.'.
    function takeCompleteSentences(input) {
        const text = String(input || "");
        const chunks = [];
        const boundary = /[.!?。！？…]+["'’”»)\]\}\]]*(?=\s)/gu;
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
        state.lastRawSnapshot = "";
        state.carry = "";
        state.spokenSentences = [];
        // Keep requestEpoch until the outstanding request returns so its audio
        // can be rejected by the queue guard if this generation was cancelled.
        if (clearQueues) clearLiveQueues(!!stopPlayback);
        installOutputQueueGuard();
    }

    function beginLiveSession() {
        if (state.sessionOpen || state.finalized) resetLiveState(true, true);
        state.active = true;
        state.finalizing = false;
        state.finalized = false;
        state.sessionOpen = true;
        state.lastSnapshot = "";
        state.lastRawSnapshot = "";
        state.carry = "";
        state.spokenSentences = [];
        try { tts_queue_embed = false; } catch (_) {}
        try { tts_queue_download = false; } catch (_) {}
        installOutputQueueGuard();
        console.info("Live Narration: started for the current streamed response.");
    }

    function enqueueSentence(sentence) {
        let clean = String(sentence || "").trim();
        if (typeof strip_tts_media_placeholders === "function") clean = strip_tts_media_placeholders(clean);
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
        const rawCurrent = String(fullText || "");
        if (!rawCurrent || state.finalizing) return;

        const current = filterThinkingFromStream(rawCurrent);

        if (state.finalized) {
            if (rawCurrent === state.lastRawSnapshot) return;
            console.info("Live Narration: new generation detected after a completed response.");
            resetLiveState(true, true);
        }

        if (!state.active) {
            if (getLiveModeReason()) return;
            beginLiveSession();
        }

        // Treat a shrinking/replaced cumulative stream as Retry/new generation.
        if (state.lastRawSnapshot && !rawCurrent.startsWith(state.lastRawSnapshot)) {
            console.info("Live Narration: detected a new/replaced stream; clearing the previous pending queue.");
            resetLiveState(true, true);
            if (getLiveModeReason()) return;
            beginLiveSession();
        }

        if (rawCurrent === state.lastRawSnapshot) return;

        // Compare filtered cumulative text, not the raw text. This ensures that
        // text following a completed </think> block is appended exactly once.
        const delta = current.startsWith(state.lastSnapshot)
            ? current.slice(state.lastSnapshot.length)
            : "";

        state.lastRawSnapshot = rawCurrent;
        state.lastSnapshot = current;

        if (delta) {
            state.carry += delta;
            enqueueCompleteSentences(state.carry, false);
        }
    }

    function finishLiveSession(finalText) {
        if (!state.active || state.finalized) return;
        const safeFinalText = filterThinkingFromStream(String(finalText || ""));
        const finalClean = typeof strip_tts_media_placeholders === "function"
            ? strip_tts_media_placeholders(safeFinalText)
            : safeFinalText;
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
                remainder = (finalNormalized.slice(0, spokenAt) + " " + finalNormalized.slice(spokenAt + spokenNormalized.length)).trim();
            } else if (spokenNormalized.startsWith(finalNormalized)) {
                remainder = "";
            } else {
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
                        <span class="helpicon">?<span class="helptext">Start TTS while the LLM is still generating. Complete sentences are sent to the existing audio TTS queue as soon as they arrive. Supports XTTS, AllTalk, OpenAI-compatible TTS and KoboldCpp TTS. Thinking blocks are excluded from live speech. The existing Narration streaming option remains unchanged.</span></span>
                    </div>
                    <div class="push-right">
                        <input title="Live Narration during LLM generation" type="checkbox" id="tts_live_narration">
                    </div>
                </div>
                <div class="menutext" id="live_narration_info" style="font-size:0.9em">
                    Live Narration uses sentence boundaries. Thinking blocks are excluded. It falls back to normal narration when Narrate only dialog or Save/Embed Narrations is enabled. Browser-only TTS is not supported by this live queue.
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

    function armForNextGeneration() {
        if (!state.finalized) return;
        state.active = false;
        state.finalizing = false;
        state.finalized = false;
        state.sessionOpen = false;
        state.lastSnapshot = "";
        state.lastRawSnapshot = "";
        state.carry = "";
        state.spokenSentences = [];
    }

    const previousPrepareSubmitGeneration = prepare_submit_generation;
    prepare_submit_generation = function (...args) {
        armForNextGeneration();
        return previousPrepareSubmitGeneration.apply(this, args);
    };

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
            if (state.active) resetLiveState(true, false);
        }
    };

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
        filterThinkingFromStream,
        takeCompleteSentences
    };

    installOutputQueueGuard();
    console.log("KoboldAI Lite Live Narration patch v1.0.0 installed (thinking filter enabled).");
})();
