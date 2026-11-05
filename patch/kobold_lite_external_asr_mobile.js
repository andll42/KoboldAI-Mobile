/* KOBOLD_LITE_EXTERNAL_ASR_PATCH v4-mobile
 * Injected into the official KoboldAI Lite pwa-setup script immediately before init().
 * Adds a selectable OpenAI-compatible ASR provider without replacing KoboldCpp Whisper.
 * The upstream microphone/VAD/MediaRecorder/WAV/LLM/TTS paths remain in place.
 */
(function installKoboldLiteExternalASR() {
    if (window.__koboldLiteExternalASRInstalled) return;
    window.__koboldLiteExternalASRInstalled = true;

    const ASR_SETTINGS_STORAGE_KEY = "asr_external_profile_v3";
    const ASR_FIELDS = [
        "asr_provider",
        "asr_base_url",
        "asr_endpoint_path",
        "asr_model",
        "asr_api_key",
        "asr_extra_fields",
        "voice_langcode"
    ];

    // The upstream defaultsettings object is a mutable clone of localsettings.
    localsettings.asr_provider = localsettings.asr_provider || "koboldcpp";
    localsettings.asr_base_url = localsettings.asr_base_url || "";
    localsettings.asr_endpoint_path = localsettings.asr_endpoint_path || "/audio/transcriptions";
    localsettings.asr_model = localsettings.asr_model || "";
    localsettings.asr_api_key = localsettings.asr_api_key || "";
    localsettings.asr_extra_fields = localsettings.asr_extra_fields || "";

    defaultsettings.asr_provider = "koboldcpp";
    defaultsettings.asr_base_url = "";
    defaultsettings.asr_endpoint_path = "/audio/transcriptions";
    defaultsettings.asr_model = "";
    defaultsettings.asr_api_key = "";
    defaultsettings.asr_extra_fields = "";

    // Prevent imported story settings from replacing this browser's ASR profile.
    // The API key is separately redacted from exported save files below.
    ASR_FIELDS.forEach(field => { PROTECTED_FIELDS[field] = true; });

    let persistedAsrSettings = null;
    let persistedAsrSettingsLoaded = false;

    function snapshotAsrSettings() {
        const result = {};
        ASR_FIELDS.forEach(field => {
            result[field] = localsettings[field] == null ? "" : String(localsettings[field]);
        });
        result.asr_provider = result.asr_provider === "openai" ? "openai" : "koboldcpp";
        result.asr_endpoint_path = result.asr_endpoint_path || "/audio/transcriptions";
        result.asr_model = result.asr_model || "";
        result.voice_langcode = result.voice_langcode || "auto";
        return result;
    }

    function sanitizeAsrSettings(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const safe = {
            asr_provider: value.asr_provider === "openai" ? "openai" : "koboldcpp",
            asr_base_url: typeof value.asr_base_url === "string" ? value.asr_base_url.slice(0, 2048) : "",
            asr_endpoint_path: typeof value.asr_endpoint_path === "string" ? value.asr_endpoint_path.slice(0, 512) : "/audio/transcriptions",
            asr_model: typeof value.asr_model === "string" ? value.asr_model.slice(0, 256) : "",
            asr_api_key: typeof value.asr_api_key === "string" ? value.asr_api_key.slice(0, 4096) : "",
            asr_extra_fields: typeof value.asr_extra_fields === "string" ? value.asr_extra_fields.slice(0, 4096) : "",
            voice_langcode: typeof value.voice_langcode === "string" ? value.voice_langcode.slice(0, 32) : "auto"
        };
        return safe;
    }

    function applyPersistedAsrSettings() {
        if (!persistedAsrSettingsLoaded || !persistedAsrSettings) return;
        ASR_FIELDS.forEach(field => {
            if (Object.prototype.hasOwnProperty.call(persistedAsrSettings, field)) {
                localsettings[field] = persistedAsrSettings[field];
            }
        });
    }

    function persistAsrSettings() {
        persistedAsrSettings = snapshotAsrSettings();
        persistedAsrSettingsLoaded = true;
        return indexeddb_save(ASR_SETTINGS_STORAGE_KEY, JSON.stringify(persistedAsrSettings))
            .catch(error => console.error("Could not save the ASR profile:", error));
    }

    function getAsrConfig() {
        return {
            provider: localsettings.asr_provider === "openai" ? "openai" : "koboldcpp",
            baseUrl: String(localsettings.asr_base_url || "").trim(),
            endpointPath: String(localsettings.asr_endpoint_path || "/audio/transcriptions").trim(),
            model: String(localsettings.asr_model || "").trim(),
            apiKey: String(localsettings.asr_api_key || "").trim(),
            extraFields: String(localsettings.asr_extra_fields || "").trim(),
            language: String(localsettings.voice_langcode || "auto").trim(),
            suppressNonSpeech: !!localsettings.voice_suppress_nonspeech
        };
    }

    function normalizeAsrBaseUrl(rawUrl) {
        let parsed;
        try {
            parsed = new URL(String(rawUrl || "").trim());
        } catch (error) {
            throw new Error("ASR Base URL must be an absolute URL, for example http://127.0.0.1:8000/v1.");
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("ASR Base URL must use http:// or https://.");
        }
        if (parsed.username || parsed.password || parsed.search || parsed.hash) {
            throw new Error("Do not put credentials, query parameters or fragments in the ASR Base URL.");
        }
        const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        const isLoopback = host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
        const isCapacitorNative = !!(
            window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === "function" &&
            window.Capacitor.isNativePlatform()
        );
        // The Android package is a locally bundled app with an explicit WebView
        // LAN-HTTP policy. Ordinary browser copies remain subject to mixed-content
        // restrictions; this does not weaken Firefox/Chrome outside the APK.
        if (window.location.protocol === "https:" && parsed.protocol === "http:" && !isLoopback && !isCapacitorNative) {
            throw new Error("Mixed content blocked: a normal HTTPS browser page cannot call a remote HTTP ASR server. Use HTTPS or the KoboldAI Mobile Android app on a trusted private Wi-Fi network.");
        }
        const base = parsed.href.replace(/\/+$/, "");
        if (/\/audio\/transcriptions$/i.test(parsed.pathname.replace(/\/+$/, ""))) {
            throw new Error("Put only the API base URL here (for example https://host.example/v1); set the transcription route in ASR Endpoint Path.");
        }
        return base;
    }

    function normalizeAsrEndpointPath(rawPath) {
        let path = String(rawPath || "/audio/transcriptions").trim();
        if (!path) path = "/audio/transcriptions";
        if (!path.startsWith("/")) path = "/" + path;
        if (path.startsWith("//")) {
            throw new Error("ASR Endpoint Path must be a relative path such as /audio/transcriptions or /v1/audio/transcriptions, without query strings or '..'.");
        }
        if (path.length > 1) path = path.replace(/\/+$/, "");
        if (path === "/" || path.includes("://") || path.includes("\\") || /[\u0000-\u001f]/.test(path) || path.includes("?") || path.includes("#") || path.split("/").includes("..")) {
            throw new Error("ASR Endpoint Path must be a relative path such as /audio/transcriptions or /v1/audio/transcriptions, without query strings or '..'.");
        }
        return path;
    }

    function buildAsrUrl(baseUrl, endpointPath) {
        const base = normalizeAsrBaseUrl(baseUrl);
        const path = normalizeAsrEndpointPath(endpointPath);
        return base + "/" + path.replace(/^\/+/, "");
    }

    function buildAsrModelsUrl(baseUrl, endpointPath) {
        const base = normalizeAsrBaseUrl(baseUrl);
        const path = normalizeAsrEndpointPath(endpointPath);
        const suffix = "/audio/transcriptions";
        const apiPrefix = path.toLowerCase().endsWith(suffix) ? path.slice(0, -suffix.length) : "";
        return base + apiPrefix + "/models";
    }

    function isExternalAsrConfigured() {
        const cfg = getAsrConfig();
        if (!cfg.baseUrl) return false;
        try {
            buildAsrUrl(cfg.baseUrl, cfg.endpointPath);
            return true;
        } catch (error) {
            return false;
        }
    }

    const originalKcppWhisperProbe = is_using_kcpp_with_whisper;
    const originalDisplaySettings = display_settings;
    const originalConfirmSettings = confirm_settings;
    const originalImportProps = import_props_into_object;
    const originalGenerateSavefile = generate_savefile;

    function asrIsAvailable() {
        const cfg = getAsrConfig();
        return cfg.provider === "openai" ? isExternalAsrConfigured() : originalKcppWhisperProbe();
    }

    // This is the capability predicate used by Lite's voice button, recording,
    // attachment transcription and settings gates. Built-in detection is unchanged.
    is_using_kcpp_with_whisper = asrIsAvailable;

    function setAsrStatus(message, isError) {
        const status = document.getElementById("asr_status");
        if (!status) return;
        status.textContent = message || "";
        status.style.color = isError ? "#d9534f" : "";
    }

    function insertAsrSettingsUI() {
        if (document.getElementById("asr_provider")) return;
        const languageInput = document.getElementById("voice_langcode");
        if (!languageInput) throw new Error("KoboldAI Lite anchor #voice_langcode was not found.");
        const languageRow = languageInput.closest(".settinglabel");
        if (!languageRow) throw new Error("KoboldAI Lite Audio Input settings row was not found.");

        languageRow.insertAdjacentHTML("beforebegin", `
            <div class="settinglabel" id="asr_provider_row">
                <div class="justifyleft" style="padding:2px">ASR Provider
                    <span class="helpicon">?<span class="helptext">Built-in uses KoboldCpp Whisper (or its audio-capable projector). Custom uses an external OpenAI-compatible transcription server and does not require Whisper in KoboldCpp.</span></span>
                </div>
                <div class="push-right">
                    <select title="ASR Provider" class="form-control" id="asr_provider" onchange="update_asr_ui()">
                        <option value="koboldcpp">Built-in KoboldCpp</option>
                        <option value="openai">Custom OpenAI-compatible ASR</option>
                    </select>
                </div>
            </div>
            <div class="settinglabel hidden" id="asr_base_url_row">
                <div class="justifyleft" style="padding:2px">ASR Base URL</div>
                <div class="push-right" style="width:60%">
                    <input title="ASR Base URL" class="settinglabel" style="width:100%" type="url" id="asr_base_url" placeholder="https://api.example.com/v1" autocomplete="off" oninput="update_asr_ui()">
                </div>
            </div>
            <div class="settinglabel hidden" id="asr_endpoint_path_row">
                <div class="justifyleft" style="padding:2px">ASR Endpoint Path
                    <span class="helpicon">?<span class="helptext">Appended to Base URL. Default: /audio/transcriptions. For example, set /v1/audio/transcriptions if the base URL has no /v1 prefix.</span></span>
                </div>
                <div class="push-right" style="width:60%">
                    <input title="ASR Endpoint Path" class="settinglabel" style="width:100%" type="text" id="asr_endpoint_path" value="/audio/transcriptions" placeholder="/audio/transcriptions" autocomplete="off" oninput="update_asr_ui()">
                </div>
            </div>
            <div class="settinglabel hidden" id="asr_model_row">
                <div class="justifyleft" style="padding:2px">ASR Model</div>
                <div class="push-right" style="width:60%">
                    <input title="ASR Model" class="settinglabel" style="width:100%" type="text" id="asr_model" value="" placeholder="whisper-1 (if required by the server)" autocomplete="off" oninput="update_asr_ui()">
                </div>
            </div>
            <div class="settinglabel hidden" id="asr_api_key_row">
                <div class="justifyleft" style="padding:2px">ASR API Key
                    <span class="helpicon">?<span class="helptext">Optional Bearer token. It is stored in this browser profile in readable local browser storage; password masking is not encryption. Do not use a privileged key in a public/shared browser.</span></span>
                </div>
                <div class="push-right" style="width:60%">
                    <input title="ASR API Key" class="settinglabel" style="width:100%" type="password" id="asr_api_key" placeholder="Optional Bearer token" autocomplete="new-password" oninput="update_asr_ui()">
                </div>
            </div>
            <div class="settinglabel hidden" id="asr_extra_fields_row">
                <div class="justifyleft" style="padding:2px">Extra multipart fields
                    <span class="helpicon">?<span class="helptext">Optional JSON object for server-specific fields, for example {"response_format":"json"}. file, model and language are managed by Lite.</span></span>
                </div>
                <div class="push-right" style="width:60%">
                    <textarea title="Extra ASR multipart fields" class="settinglabel" style="width:100%;height:58px" id="asr_extra_fields" placeholder='{"response_format":"json"}' oninput="update_asr_ui()"></textarea>
                </div>
            </div>
            <div class="settinglabel hidden" id="asr_test_row">
                <div class="justifyleft" style="padding:2px">External ASR Server</div>
                <div class="push-right">
                    <button type="button" class="btn btn-primary" id="asr_test_btn" onclick="test_external_asr_connection()">Test connection</button>
                </div>
            </div>
            <div class="settinglabel hidden" id="asr_ready_row">
                <div class="justifyleft" style="padding:2px">GigaSTT model status</div>
                <div class="push-right">
                    <button type="button" class="btn btn-default" id="asr_ready_btn" onclick="test_external_asr_readiness()">Check GigaSTT readiness</button>
                </div>
            </div>
            <div class="menutext hidden" id="asr_status" role="status" aria-live="polite"></div>
            <div class="menutext hidden" id="asr_cors_note" style="font-size:0.9em">
                Test connection and GigaSTT readiness send GET only; they never activate the microphone or upload audio. In KoboldAI Mobile the app origin is https://localhost; allow that exact origin on GigaSTT. The APK permits HTTP only for the configured private-LAN backend path. Keep GigaSTT/KoboldCpp off public port forwarding. Desktop browser copies still need normal HTTPS/CORS rules.
            </div>
        `);

        const voiceModeHelp = document.querySelector("#voice_typing_mode")?.closest(".settinglabel")?.querySelector(".helptext");
        if (voiceModeHelp) {
            voiceModeHelp.textContent = "Requires either built-in KoboldCpp transcription or a configured external OpenAI-compatible ASR server. Supports Detect Voice, Push-To-Talk and Toggle-To-Talk.";
        }
    }

    function syncAsrControlsFromSettings() {
        const provider = document.getElementById("asr_provider");
        if (!provider) return;
        provider.value = localsettings.asr_provider || "koboldcpp";
        document.getElementById("asr_base_url").value = localsettings.asr_base_url || "";
        document.getElementById("asr_endpoint_path").value = localsettings.asr_endpoint_path || "/audio/transcriptions";
        document.getElementById("asr_model").value = localsettings.asr_model || "";
        document.getElementById("asr_api_key").value = localsettings.asr_api_key || "";
        document.getElementById("asr_extra_fields").value = localsettings.asr_extra_fields || "";
        update_asr_ui();
    }

    window.update_asr_ui = function update_asr_ui() {
        const provider = document.getElementById("asr_provider");
        if (!provider) return;

        // Keep the live capability check in step with edits made in the settings UI.
        localsettings.asr_provider = provider.value === "openai" ? "openai" : "koboldcpp";
        localsettings.asr_base_url = document.getElementById("asr_base_url").value.trim();
        localsettings.asr_endpoint_path = document.getElementById("asr_endpoint_path").value.trim() || "/audio/transcriptions";
        localsettings.asr_model = document.getElementById("asr_model").value.trim();
        localsettings.asr_api_key = document.getElementById("asr_api_key").value.trim();
        localsettings.asr_extra_fields = document.getElementById("asr_extra_fields").value;

        const custom = localsettings.asr_provider === "openai";
        ["asr_base_url_row", "asr_endpoint_path_row", "asr_model_row", "asr_api_key_row", "asr_extra_fields_row", "asr_test_row", "asr_ready_row", "asr_status", "asr_cors_note"].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.classList.toggle("hidden", !custom);
        });

        const suppress = document.getElementById("voice_suppress_nonspeech");
        if (suppress) {
            suppress.disabled = custom;
            suppress.title = custom ? "This KoboldCpp-specific option is not sent to external ASR servers." : "Suppress non-speech sounds during built-in transcription.";
        }

        const available = asrIsAvailable();
        const voiceMode = document.getElementById("voice_typing_mode");
        const fileButton = document.getElementById("transcribe_file_btn");
        if (voiceMode) voiceMode.disabled = !available;
        if (fileButton) fileButton.disabled = !available;
        if (typeof update_mini_action_toggles_visibility === "function") {
            update_mini_action_toggles_visibility();
        }
        if (typeof update_submit_button === "function") {
            update_submit_button(false);
        }
    };

    window.load_kobold_lite_external_asr_settings = async function load_kobold_lite_external_asr_settings() {
        try {
            const raw = await indexeddb_load(ASR_SETTINGS_STORAGE_KEY, "");
            if (raw) persistedAsrSettings = sanitizeAsrSettings(JSON.parse(raw));
        } catch (error) {
            console.warn("Could not load the separate ASR profile:", error);
        }
        persistedAsrSettingsLoaded = true;
        applyPersistedAsrSettings();
        syncAsrControlsFromSettings();
        return true;
    };

    window.test_external_asr_connection = async function test_external_asr_connection() {
        const baseInput = document.getElementById("asr_base_url");
        const keyInput = document.getElementById("asr_api_key");
        let base;
        try {
            base = buildAsrModelsUrl(baseInput ? baseInput.value : "", document.getElementById("asr_endpoint_path")?.value || "/audio/transcriptions");
        } catch (error) {
            setAsrStatus(error.message, true);
            return;
        }

        const headers = {};
        const apiKey = keyInput ? keyInput.value.trim() : "";
        if (apiKey) headers.Authorization = "Bearer " + apiKey;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        setAsrStatus("Checking the standard models-list route. No audio will be uploaded.", false);
        try {
            const response = await fetch(base, {
                method: "GET",
                headers,
                credentials: "omit",
                cache: "no-store",
                referrerPolicy: "no-referrer",
                signal: controller.signal
            });
            if (response.ok) {
                setAsrStatus("Server reachable: GET " + new URL(base).pathname + " returned HTTP " + response.status + ". No audio was uploaded. This does not yet test the transcription route.", false);
            } else {
                const detail = (await response.text()).slice(0, 240);
                const note = response.status === 404
                    ? "The server is reachable, but it does not expose the inferred standard models-list route; the transcription route remains untested."
                    : "The server is reachable but returned an HTTP error; check its authentication or /models implementation.";
                setAsrStatus(note + " HTTP " + response.status + (detail ? ": " + detail : ""), true);
            }
        } catch (error) {
            if (error && error.name === "AbortError") {
                setAsrStatus("Connection test timed out after 8 seconds.", true);
            } else {
                setAsrStatus("The browser could not read the ASR response. Check network access, CORS (including OPTIONS/Authorization), TLS and mixed-content rules. Browsers intentionally do not distinguish CORS from some network failures. Details: " + (error.message || String(error)), true);
            }
        } finally {
            clearTimeout(timeout);
        }
    };

    window.test_external_asr_readiness = async function test_external_asr_readiness() {
        let readyUrl;
        try {
            const base = new URL(normalizeAsrBaseUrl(document.getElementById("asr_base_url")?.value || ""));
            // GigaSTT exposes /ready at server root, while the OpenAI base URL ends in /v1.
            const rootPath = base.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "");
            readyUrl = base.origin + rootPath + "/ready";
        } catch (error) {
            setAsrStatus(error.message, true);
            return;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        setAsrStatus("Checking GigaSTT GET /ready. No audio will be uploaded.", false);
        try {
            const response = await fetch(readyUrl, {
                method: "GET",
                credentials: "omit",
                cache: "no-store",
                referrerPolicy: "no-referrer",
                signal: controller.signal
            });
            const raw = await response.text();
            let data = null;
            try { data = raw ? JSON.parse(raw) : {}; } catch (error) { /* handled below */ }
            if (response.ok && data && data.status === "ready") {
                setAsrStatus("GigaSTT is ready: " + readyUrl + " (HTTP " + response.status + "). No audio was uploaded.", false);
            } else if (response.ok) {
                setAsrStatus("GigaSTT answered HTTP " + response.status + " but did not report status=ready: " + raw.slice(0, 300), true);
            } else {
                setAsrStatus("GigaSTT readiness returned HTTP " + response.status + ": " + raw.slice(0, 400), true);
            }
        } catch (error) {
            const detail = error && error.name === "AbortError" ? "Timed out after 8 seconds." : (error.message || String(error));
            setAsrStatus("Could not read GigaSTT /ready. Check PC IP, port 9876, Windows Firewall and GigaSTT --bind-all/--allow-origin. " + detail, true);
        } finally {
            clearTimeout(timeout);
        }
    };

    // Keep upstream settings UI and save flow; the separate ASR profile is loaded
    // before init() and remains available when persist_session is disabled.
    display_settings = function (...args) {
        const result = originalDisplaySettings.apply(this, args);
        syncAsrControlsFromSettings();
        return result;
    };

    confirm_settings = function (...args) {
        const provider = document.getElementById("asr_provider");
        if (provider) update_asr_ui();
        const result = originalConfirmSettings.apply(this, args);
        update_asr_ui(); // refresh the mic/send button after voice_typing_mode is applied upstream
        persistAsrSettings();
        return result;
    };

    import_props_into_object = function (existingObj, objToImport) {
        const result = originalImportProps.apply(this, arguments);
        if (existingObj === localsettings) {
            applyPersistedAsrSettings();
            syncAsrControlsFromSettings();
        }
        return result;
    };

    generate_savefile = function (...args) {
        const saveObject = originalGenerateSavefile.apply(this, args);
        if (saveObject && saveObject.savedsettings) {
            saveObject.savedsettings.asr_api_key = "";
        }
        return saveObject;
    };

    function stringifyErrorDetail(value) {
        if (value == null) return "";
        if (typeof value === "string") return value;
        try { return JSON.stringify(value); } catch (error) { return String(value); }
    }

    async function readTranscriptionResponse(response) {
        const raw = await response.text();
        let data = null;
        try {
            data = raw ? JSON.parse(raw) : {};
        } catch (error) {
            data = null;
        }

        if (!response.ok) {
            let detail = "";
            if (data && typeof data === "object") {
                detail = stringifyErrorDetail(
                    (data.error && (data.error.message || data.error)) ||
                    (data.detail && (data.detail.msg || data.detail.message || data.detail)) ||
                    data.message
                );
            }
            if (!detail) detail = raw.slice(0, 500);
            throw new Error("ASR server returned HTTP " + response.status + (detail ? ": " + detail : ""));
        }

        if (!data || typeof data !== "object" || typeof data.text !== "string") {
            const contentType = response.headers.get("content-type") || "unknown content type";
            throw new Error("ASR response must be JSON containing a string field 'text' (received " + contentType + "). Check the server's response format.");
        }
        return data.text.trim();
    }

    function parseExtraMultipartFields(raw) {
        if (!raw) return [];
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            throw new Error("Extra multipart fields must be a valid JSON object.");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Extra multipart fields must be a JSON object, not an array or scalar.");
        }
        const reserved = new Set(["file", "model", "language"]);
        const fields = [];
        Object.keys(parsed).forEach(key => {
            if (!key.trim() || reserved.has(key.toLowerCase())) {
                throw new Error("Extra multipart fields cannot override file, model or language.");
            }
            const value = parsed[key];
            if (value === null || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) {
                throw new Error("Extra multipart field '" + key + "' must be a string, number or boolean.");
            }
            fields.push([key, String(value)]);
        });
        return fields;
    }

    async function transcribeDataUrl(dataUrl) {
        const cfg = getAsrConfig();

        if (cfg.provider !== "openai") {
            // Preserve the current KoboldCpp Lite JSON contract exactly.
            const payload = {
                audio_data: dataUrl,
                prompt: "",
                suppress_non_speech: cfg.suppressNonSpeech,
                langcode: cfg.language || "auto"
            };
            let response;
            try {
                response = await fetch(apply_proxy_url(custom_kobold_endpoint + koboldcpp_transcribe_endpoint), {
                    method: "POST",
                    headers: get_kobold_header(),
                    body: JSON.stringify(payload)
                });
            } catch (error) {
                throw new Error("Built-in KoboldCpp transcription request failed: " + (error.message || String(error)));
            }
            return await readTranscriptionResponse(response);
        }

        const endpointUrl = buildAsrUrl(cfg.baseUrl, cfg.endpointPath);
        const extraFields = parseExtraMultipartFields(cfg.extraFields);

        let audioBlob;
        try {
            audioBlob = await (await fetch(dataUrl)).blob();
        } catch (error) {
            throw new Error("Could not decode the recorded WAV data: " + (error.message || String(error)));
        }
        if (!audioBlob || !audioBlob.size) throw new Error("The recorded audio file is empty.");

        const form = new FormData();
        form.append("file", audioBlob, "speech.wav");
        if (cfg.model) form.append("model", cfg.model);
        if (cfg.language && cfg.language.toLowerCase() !== "auto") {
            form.append("language", cfg.language.toLowerCase());
        }
        extraFields.forEach(([key, value]) => form.append(key, value));

        const headers = {};
        if (cfg.apiKey) headers.Authorization = "Bearer " + cfg.apiKey;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        try {
            const response = await fetch(endpointUrl, {
                method: "POST",
                headers, // Do not set Content-Type: the browser must add the multipart boundary.
                body: form,
                credentials: "omit",
                referrerPolicy: "no-referrer",
                signal: controller.signal
            });
            return await readTranscriptionResponse(response);
        } catch (error) {
            if (error && error.name === "AbortError") {
                throw new Error("External ASR request timed out after 120 seconds.");
            }
            if (error instanceof TypeError) {
                throw new Error("The browser could not access the external ASR server. This is commonly a network or CORS/preflight failure. Allow this Lite page's origin, POST/OPTIONS and (when used) the Authorization header. HTTPS pages cannot call remote HTTP servers. Details: " + (error.message || String(error)));
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    function blobToWavDataUrl(inputBlob) {
        return new Promise((resolve, reject) => {
            try {
                audioBlobToDecodedAudioBuffer(inputBlob, buffer => {
                    try {
                        resampleAudioBuffer(buffer, 16000, resampledBuffer => {
                            try {
                                const wavBlob = audioBufferToWavBlob(resampledBuffer);
                                const reader = new FileReader();
                                reader.onload = () => resolve(reader.result);
                                reader.onerror = () => reject(new Error("Could not read the converted WAV audio."));
                                reader.readAsDataURL(wavBlob);
                            } catch (error) {
                                reject(error);
                            }
                        });
                    } catch (error) {
                        reject(error);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    // The existing VAD, PTT/TTT controls and MediaRecorder continue to call this
    // entry point. Only the provider-specific HTTP request is changed.
    dispatch_transcribe_audio = async function (dataUrl) {
        voice_is_processing = true;
        update_submit_button(false);
        let processingReleased = false;
        try {
            const transcript = await transcribeDataUrl(dataUrl);
            // Match upstream ordering: release the voice-processing gate before
            // checking btnsend, otherwise Lite considers submission still blocked.
            voice_is_processing = false;
            update_submit_button(false);
            processingReleased = true;

            const trimmed = transcript.trim();
            const noise = trimmed.startsWith("(") && trimmed.endsWith(")");
            const blank = trimmed.startsWith("[") && trimmed.endsWith("]");
            const willSubmit = !document.getElementById("btnsend").disabled;
            if (willSubmit && trimmed && !noise && !blank) {
                document.getElementById("input_text").value = trimmed;
                prepare_submit_generation();
            }
        } catch (error) {
            console.error("ASR transcription failed:", error);
            setAsrStatus(error.message || String(error), true);
            if (typeof msgbox === "function") {
                msgbox("Speech recognition failed: " + (error.message || String(error)), "ASR Error");
            }
        } finally {
            if (!processingReleased) {
                voice_is_processing = false;
                update_submit_button(false);
            }
        }
    };

    transcribe_audio_file = function (audiohash, onDone) {
        const fetchedBlob = data_hash_to_blob_lookup[audiohash];
        if (!fetchedBlob) {
            if (onDone) onDone(null);
            return;
        }
        fetch(fetchedBlob.blob)
            .then(response => response.blob())
            .then(blobToWavDataUrl)
            .then(transcribeDataUrl)
            .then(text => { if (onDone) onDone(text); })
            .catch(error => {
                console.error("Audio attachment ASR failed:", error);
                setAsrStatus(error.message || String(error), true);
                if (typeof msgbox === "function") msgbox("Audio attachment transcription failed: " + (error.message || String(error)), "ASR Error");
                if (onDone) onDone(null);
            });
    };

    transcribe_file_btn = function () {
        if (!asrIsAvailable()) {
            if (typeof msgbox === "function") msgbox("Configure an available ASR provider in Settings > Media > Audio Input first.", "ASR Not Available");
            return;
        }
        const fileInput = document.getElementById("transcribe_file_input");
        fileInput.click();
        fileInput.onchange = event => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            blobToWavDataUrl(file)
                .then(transcribeDataUrl)
                .then(text => msgbox(text || "No speech was recognized.", "Transcribed Audio"))
                .catch(error => {
                    console.error("Audio file ASR failed:", error);
                    setAsrStatus(error.message || String(error), true);
                    msgbox("Audio transcription failed: " + (error.message || String(error)), "ASR Error");
                })
                .finally(() => { fileInput.value = ""; });
        };
    };

    insertAsrSettingsUI();
    syncAsrControlsFromSettings();
    console.log("KoboldAI Lite external ASR adapter v3 installed.");
})();
