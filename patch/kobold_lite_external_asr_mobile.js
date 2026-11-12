/* KOBOLD_LITE_EXTERNAL_ASR_PATCH v5-android-asr
 * Injected into the official KoboldAI Lite pwa-setup script immediately before init().
 * Adds GigaSTT/OpenAI-compatible ASR and a strict native Android on-device ASR option.
 * KoboldCpp and GigaSTT continue to use the upstream microphone/VAD/MediaRecorder/WAV path.
 * Android ASR delegates microphone capture to SpeechRecognizer and never falls back online.
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
        "asr_android_language",
        "voice_langcode"
    ];

    // The upstream defaultsettings object is a mutable clone of localsettings.
    localsettings.asr_provider = localsettings.asr_provider || "koboldcpp";
    localsettings.asr_base_url = localsettings.asr_base_url || "";
    localsettings.asr_endpoint_path = localsettings.asr_endpoint_path || "/audio/transcriptions";
    localsettings.asr_model = localsettings.asr_model || "";
    localsettings.asr_api_key = localsettings.asr_api_key || "";
    localsettings.asr_extra_fields = localsettings.asr_extra_fields || "";
    localsettings.asr_android_language = localsettings.asr_android_language || "ru-RU";

    defaultsettings.asr_provider = "koboldcpp";
    defaultsettings.asr_base_url = "";
    defaultsettings.asr_endpoint_path = "/audio/transcriptions";
    defaultsettings.asr_model = "";
    defaultsettings.asr_api_key = "";
    defaultsettings.asr_extra_fields = "";
    defaultsettings.asr_android_language = "ru-RU";

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
        result.asr_provider = ["openai", "android"].includes(result.asr_provider) ? result.asr_provider : "koboldcpp";
        result.asr_android_language = result.asr_android_language || "ru-RU";
        result.asr_endpoint_path = result.asr_endpoint_path || "/audio/transcriptions";
        result.asr_model = result.asr_model || "";
        result.voice_langcode = result.voice_langcode || "auto";
        return result;
    }

    function sanitizeAsrSettings(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const safe = {
            asr_provider: ["openai", "android"].includes(value.asr_provider) ? value.asr_provider : "koboldcpp",
            asr_base_url: typeof value.asr_base_url === "string" ? value.asr_base_url.slice(0, 2048) : "",
            asr_endpoint_path: typeof value.asr_endpoint_path === "string" ? value.asr_endpoint_path.slice(0, 512) : "/audio/transcriptions",
            asr_model: typeof value.asr_model === "string" ? value.asr_model.slice(0, 256) : "",
            asr_api_key: typeof value.asr_api_key === "string" ? value.asr_api_key.slice(0, 4096) : "",
            asr_extra_fields: typeof value.asr_extra_fields === "string" ? value.asr_extra_fields.slice(0, 4096) : "",
            asr_android_language: typeof value.asr_android_language === "string" ? value.asr_android_language.slice(0, 32) : "ru-RU",
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
            provider: ["openai", "android"].includes(localsettings.asr_provider) ? localsettings.asr_provider : "koboldcpp",
            baseUrl: String(localsettings.asr_base_url || "").trim(),
            endpointPath: String(localsettings.asr_endpoint_path || "/audio/transcriptions").trim(),
            model: String(localsettings.asr_model || "").trim(),
            apiKey: String(localsettings.asr_api_key || "").trim(),
            extraFields: String(localsettings.asr_extra_fields || "").trim(),
            androidLanguage: String(localsettings.asr_android_language || "ru-RU").trim() || "ru-RU",
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
    const originalInitVoiceTyping = init_voice_typing;
    const originalPttStart = ptt_start;
    const originalPttEnd = ptt_end;
    const originalUpdateSubmitButton = update_submit_button;

    let androidNativeStatus = null;
    let androidStatusPromise = null;
    let androidInitPromise = null;
    let androidListenersRegistered = false;
    let androidNativeListening = false;
    let androidStartPromise = null;
    let androidDetectShouldResume = false;
    let androidResumeTimer = null;
    let androidToggleTranscriptBuffer = [];
    let androidManualStopRequested = false;

    function isAndroidNativeApp() {
        return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" &&
            window.Capacitor.isNativePlatform() && typeof window.Capacitor.getPlatform === "function" &&
            window.Capacitor.getPlatform() === "android");
    }

    function getAndroidSpeechPlugin() {
        return isAndroidNativeApp() ? window.KoboldAndroidSpeech : null;
    }

    async function refreshAndroidAsrStatus(force) {
        const plugin = getAndroidSpeechPlugin();
        if (!plugin) {
            androidNativeStatus = { available: false, message: "Android On-device ASR is available only in the KoboldAI Mobile Android app." };
            if (typeof window.update_asr_ui === "function") window.update_asr_ui(false);
            return androidNativeStatus;
        }
        if (androidStatusPromise && !force) return androidStatusPromise;
        androidStatusPromise = (async () => {
            try {
                const device = await plugin.getStatus();
                if (!device || !device.onDeviceAvailable) {
                    androidNativeStatus = { available: false, device, message: "This Android device does not expose an on-device SpeechRecognizer service. No online fallback will be used." };
                    return androidNativeStatus;
                }
                const language = getAsrConfig().androidLanguage;
                const support = await plugin.checkLanguageSupport({ language });
                let available = !!device.onDeviceAvailable;
                let message = "On-device recognizer is available. Language support will be confirmed when recognition starts.";
                const state = support && support.languageStatus;
                if (state === "installed") {
                    available = true;
                    message = "Offline language " + language + " is installed on this device.";
                } else if (state === "downloadable") {
                    available = false;
                    message = "Language " + language + " is supported but not installed. Use the explicit Download language model button, then check again.";
                } else if (state === "pending") {
                    available = false;
                    message = "The offline language model " + language + " is pending installation. Check again after Android finishes.";
                } else if (state === "unsupported") {
                    available = false;
                    message = "The on-device service does not list " + language + " as an installed or downloadable language.";
                } else if (state === "unknown") {
                    available = true;
                    message = "Android cannot enumerate language packs on this version/service. Strict on-device recognition will test " + language + " when started.";
                }
                androidNativeStatus = { available, device, support, message };
                return androidNativeStatus;
            } catch (error) {
                androidNativeStatus = { available: false, message: "Could not check Android on-device ASR: " + (error.message || String(error)) };
                return androidNativeStatus;
            } finally {
                androidStatusPromise = null;
                if (typeof window.update_asr_ui === "function") window.update_asr_ui(false);
                if (androidNativeStatus && androidNativeStatus.message) setAsrStatus(androidNativeStatus.message, !androidNativeStatus.available);
            }
        })();
        return androidStatusPromise;
    }

    function asrIsAvailable() {
        const cfg = getAsrConfig();
        if (cfg.provider === "openai") return isExternalAsrConfigured();
        if (cfg.provider === "android") return isAndroidNativeApp() && !!(androidNativeStatus && androidNativeStatus.available);
        return originalKcppWhisperProbe();
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
                    <span class="helpicon">?<span class="helptext">Choose built-in KoboldCpp Whisper, an external GigaSTT/OpenAI-compatible server, or strict Android on-device speech recognition. Android ASR uses the phone microphone directly and never falls back to an online recognizer.</span></span>
                </div>
                <div class="push-right">
                    <select title="ASR Provider" class="form-control" id="asr_provider" onchange="update_asr_ui()">
                        <option value="koboldcpp">Built-in KoboldCpp Whisper</option>
                        <option value="openai">GigaSTT / OpenAI-compatible ASR</option>
                        <option value="android">Android On-device ASR (Google/System)</option>
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
            <div class="settinglabel hidden" id="asr_android_language_row">
                <div class="justifyleft" style="padding:2px">Android ASR language</div>
                <div class="push-right" style="width:60%">
                    <select title="Android on-device recognition language" class="form-control" id="asr_android_language" onchange="update_asr_ui()">
                        <option value="ru-RU">Russian (ru-RU)</option>
                        <option value="en-US">English (US)</option>
                        <option value="de-DE">German (Germany)</option>
                    </select>
                </div>
            </div>
            <div class="settinglabel hidden" id="asr_android_check_row">
                <div class="justifyleft" style="padding:2px">Android on-device service</div>
                <div class="push-right">
                    <button type="button" class="btn btn-primary" id="asr_android_check_btn" onclick="check_android_asr_support()">Check device support</button>
                </div>
            </div>
            <div class="settinglabel hidden" id="asr_android_download_row">
                <div class="justifyleft" style="padding:2px">Offline language model</div>
                <div class="push-right">
                    <button type="button" class="btn btn-default" id="asr_android_download_btn" onclick="request_android_asr_model()">Download language model</button>
                </div>
            </div>
            <div class="menutext hidden" id="asr_status" role="status" aria-live="polite"></div>
            <div class="menutext hidden" id="asr_cors_note" style="font-size:0.9em">
                Test connection and GigaSTT readiness send GET only; they never activate the microphone or upload audio. In KoboldAI Mobile the app origin is https://localhost; allow that exact origin on GigaSTT. Keep GigaSTT/KoboldCpp limited to trusted private Wi-Fi and off public port forwarding.
            </div>
            <div class="menutext hidden" id="asr_android_note" style="font-size:0.9em">
                Android ASR captures audio directly through Android SpeechRecognizer. It requires an installed on-device language model to work offline. The app uses createOnDeviceSpeechRecognizer only; it will not fall back to the network recognizer. Model download is requested only when you press the button.
            </div>
        `);

        const voiceModeHelp = document.querySelector("#voice_typing_mode")?.closest(".settinglabel")?.querySelector(".helptext");
        if (voiceModeHelp) {
            voiceModeHelp.textContent = "Select KoboldCpp Whisper, GigaSTT/OpenAI-compatible ASR, or Android on-device ASR. Android uses the system speech service and does not require the PC Whisper model. Supports Detect Voice, Push-To-Talk and Toggle-To-Talk.";
        }
    }

    function syncAsrControlsFromSettings() {
        const provider = document.getElementById("asr_provider");
        if (!provider) return;
        provider.value = ["openai", "android"].includes(localsettings.asr_provider) ? localsettings.asr_provider : "koboldcpp";
        document.getElementById("asr_base_url").value = localsettings.asr_base_url || "";
        document.getElementById("asr_endpoint_path").value = localsettings.asr_endpoint_path || "/audio/transcriptions";
        document.getElementById("asr_model").value = localsettings.asr_model || "";
        document.getElementById("asr_api_key").value = localsettings.asr_api_key || "";
        document.getElementById("asr_extra_fields").value = localsettings.asr_extra_fields || "";
        const androidLanguage = document.getElementById("asr_android_language");
        if (androidLanguage) androidLanguage.value = localsettings.asr_android_language || "ru-RU";
        update_asr_ui();
    }

    window.update_asr_ui = function update_asr_ui(refreshNative = true) {
        const provider = document.getElementById("asr_provider");
        if (!provider) return;

        localsettings.asr_provider = ["openai", "android"].includes(provider.value) ? provider.value : "koboldcpp";
        localsettings.asr_base_url = document.getElementById("asr_base_url").value.trim();
        localsettings.asr_endpoint_path = document.getElementById("asr_endpoint_path").value.trim() || "/audio/transcriptions";
        localsettings.asr_model = document.getElementById("asr_model").value.trim();
        localsettings.asr_api_key = document.getElementById("asr_api_key").value.trim();
        localsettings.asr_extra_fields = document.getElementById("asr_extra_fields").value;
        const androidLanguage = document.getElementById("asr_android_language");
        localsettings.asr_android_language = androidLanguage ? androidLanguage.value : (localsettings.asr_android_language || "ru-RU");

        const custom = localsettings.asr_provider === "openai";
        const android = localsettings.asr_provider === "android";
        ["asr_base_url_row", "asr_endpoint_path_row", "asr_model_row", "asr_api_key_row", "asr_extra_fields_row", "asr_test_row", "asr_ready_row", "asr_cors_note"].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.classList.toggle("hidden", !custom);
        });
        ["asr_android_language_row", "asr_android_check_row", "asr_android_note"].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.classList.toggle("hidden", !android);
        });
        const androidDownloadRow = document.getElementById("asr_android_download_row");
        if (androidDownloadRow) androidDownloadRow.classList.toggle("hidden", !android || !(androidNativeStatus && androidNativeStatus.support && androidNativeStatus.support.languageStatus === "downloadable"));
        const androidOption = provider.querySelector('option[value="android"]');
        if (androidOption) {
            androidOption.disabled = !isAndroidNativeApp();
            androidOption.title = androidOption.disabled ? "Available only inside KoboldAI Mobile for Android." : "Strict Android on-device speech recognition; no online fallback.";
        }
        const statusElement = document.getElementById("asr_status");
        if (statusElement) statusElement.classList.toggle("hidden", !(custom || android));

        const suppress = document.getElementById("voice_suppress_nonspeech");
        if (suppress) {
            suppress.disabled = custom || android;
            suppress.title = custom || android ? "This option is used only by the built-in KoboldCpp Whisper endpoint." : "Suppress non-speech sounds during built-in transcription.";
        }

        const available = asrIsAvailable();
        const voiceMode = document.getElementById("voice_typing_mode");
        const fileButton = document.getElementById("transcribe_file_btn");
        if (voiceMode) voiceMode.disabled = !available;
        if (fileButton) {
            fileButton.disabled = !available || android;
            fileButton.title = android ? "Android on-device SpeechRecognizer listens to the live microphone; use KoboldCpp or GigaSTT for audio files." : "Transcribe an audio attachment/file.";
        }
        if (typeof update_mini_action_toggles_visibility === "function") update_mini_action_toggles_visibility();
        if (typeof update_submit_button === "function") update_submit_button(false);

        if (refreshNative && android) refreshAndroidAsrStatus(false);
        if (!android && androidInitPromise) stopAndroidSpeech(true);
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

    window.check_android_asr_support = async function check_android_asr_support() {
        if (!isAndroidNativeApp() || !getAndroidSpeechPlugin()) {
            setAsrStatus("Android On-device ASR is available only inside the Android APK.", true);
            return;
        }
        const status = await refreshAndroidAsrStatus(true);
        setAsrStatus(status.message || "Android ASR support check finished.", !status.available);
    };

    window.request_android_asr_model = async function request_android_asr_model() {
        const plugin = getAndroidSpeechPlugin();
        if (!plugin) {
            setAsrStatus("Android on-device language model download is available only in the Android APK.", true);
            return;
        }
        try {
            const result = await plugin.requestLanguageModelDownload({ language: getAsrConfig().androidLanguage });
            setAsrStatus(result.message || "Android language model download was requested. Check support again later.", false);
        } catch (error) {
            setAsrStatus(error.message || String(error), true);
        }
    };

    function submitAndroidTranscript(text) {
        const trimmed = String(text || "").trim();
        const noise = trimmed.startsWith("(") && trimmed.endsWith(")");
        const blank = trimmed.startsWith("[") && trimmed.endsWith("]");
        if (!trimmed || noise || blank) return false;
        const sendButton = document.getElementById("btnsend");
        if (!sendButton || sendButton.disabled || voice_is_processing || tts_is_playing) {
            setAsrStatus("Speech was recognized, but generation is currently busy. The text was not submitted automatically.", true);
            return false;
        }
        document.getElementById("input_text").value = trimmed;
        prepare_submit_generation();
        return true;
    }

    function registerAndroidSpeechListeners() {
        const plugin = getAndroidSpeechPlugin();
        if (!plugin || androidListenersRegistered) return;
        androidListenersRegistered = true;
        plugin.addListener("listening", () => {
            androidNativeListening = true;
            setAsrStatus("Android on-device recognizer is listening (" + getAsrConfig().androidLanguage + ").", false);
        });
        plugin.addListener("speechStart", () => {
            voice_is_recording = true;
            update_submit_button(false);
        });
        plugin.addListener("speechEnd", () => {
            voice_is_recording = false;
            update_submit_button(false);
        });
        plugin.addListener("partial", event => {
            if (event && event.text) setAsrStatus("Recognizing locally: " + event.text, false);
        });
        plugin.addListener("retry", event => {
            setAsrStatus("Android is waiting for speech: " + ((event && event.message) || "No speech detected yet."), false);
        });
        plugin.addListener("result", async event => {
            const mode = Number(localsettings.voice_typing_mode || 0);
            const text = event && event.text ? String(event.text).trim() : "";
            voice_is_recording = false;
            voice_is_processing = false;
            if (mode === 2 || mode === 3) {
                if (text) androidToggleTranscriptBuffer.push(text);
                // Android emits phrase-sized results while a manual session is
                // active. Buffer until Push-To-Talk release or the second
                // Toggle-To-Talk press; never re-arm after the user stopped.
                if (!androidManualStopRequested) voice_is_speaking = true;
                update_submit_button(false);
                return;
            }
            voice_is_speaking = false;
            if (mode === 1) {
                androidDetectShouldResume = true;
                try { await plugin.stopListening(); } catch (error) { console.warn("Could not pause Android Detect Voice:", error); }
            }
            update_submit_button(false);
            if (text) submitAndroidTranscript(text);
            if (mode === 1) scheduleAndroidDetectResume();
        });
        plugin.addListener("stopped", event => {
            androidNativeListening = false;
            voice_is_recording = false;
            voice_is_processing = false;
            const stoppedMode = Number(localsettings.voice_typing_mode || 0);
            if ((stoppedMode === 2 || stoppedMode === 3) && (androidManualStopRequested || !voice_is_speaking)) {
                const transcript = androidToggleTranscriptBuffer.join(" ").trim();
                androidToggleTranscriptBuffer = [];
                androidManualStopRequested = false;
                voice_is_speaking = false;
                submitAndroidTranscript(transcript);
            }
            update_submit_button(false);
            if (event && event.reason === "error") isVoiceInputConfigured = false;
        });
        plugin.addListener("error", event => {
            androidNativeListening = false;
            voice_is_recording = false;
            voice_is_processing = false;
            voice_is_speaking = false;
            androidDetectShouldResume = false;
            androidManualStopRequested = false;
            androidToggleTranscriptBuffer = [];
            const code = Number(event && event.code);
            const message = (event && event.message) || "Android on-device speech recognition failed.";
            // Silence/no-match/busy are normal for a manual Push-To-Talk or
            // Toggle-To-Talk session; keep Voice Input configured for the next try.
            if (code === 6 || code === 7 || code === 8) {
                setAsrStatus(message + " You can press the microphone and try again. No online fallback was used.", false);
                update_submit_button(false);
                return;
            }
            isVoiceInputConfigured = false;
            setAsrStatus(message + " No online recognizer fallback was used.", true);
            localsettings.voice_typing_mode = 0;
            const mode = document.getElementById("voice_typing_mode");
            if (mode) mode.value = "0";
            update_asr_ui(false);
            update_submit_button(false);
        });
    }

    async function ensureAndroidAsrInitialized() {
        const plugin = getAndroidSpeechPlugin();
        if (!plugin) throw new Error("Android ASR is available only in the KoboldAI Mobile Android app.");
        if (androidInitPromise) return androidInitPromise;
        androidInitPromise = (async () => {
            registerAndroidSpeechListeners();
            const status = await refreshAndroidAsrStatus(true);
            if (!status.available) throw new Error(status.message || "Android on-device speech recognition is unavailable.");
            await plugin.requestMicrophonePermission();
            isVoiceInputConfigured = true;
            setAsrStatus("Android microphone permission granted. On-device recognition is ready.", false);
            return true;
        })().catch(error => {
            androidInitPromise = null;
            isVoiceInputConfigured = false;
            throw error;
        });
        return androidInitPromise;
    }

    async function startAndroidListening(continuous) {
        const plugin = getAndroidSpeechPlugin();
        if (!plugin) throw new Error("Android SpeechRecognizer bridge is missing from this APK build.");
        if (androidNativeListening) return { started: true, alreadyListening: true };
        if (androidStartPromise) return androidStartPromise;
        androidStartPromise = (async () => {
            await ensureAndroidAsrInitialized();
            voice_is_recording = true;
            voice_is_processing = false;
            update_submit_button(false);
            try {
                const result = await plugin.startListening({ language: getAsrConfig().androidLanguage, continuous: !!continuous });
                androidNativeListening = true;
                setAsrStatus("Android on-device ASR started for " + result.language + ". Audio is handled by the Android on-device recognizer; no network recognizer fallback is used.", false);
                return result;
            } catch (error) {
                voice_is_recording = false;
                androidNativeListening = false;
                update_submit_button(false);
                throw error;
            }
        })().finally(() => { androidStartPromise = null; });
        return androidStartPromise;
    }

    async function stopAndroidSpeech(cancel) {
        const plugin = getAndroidSpeechPlugin();
        androidDetectShouldResume = false;
        androidManualStopRequested = false;
        androidToggleTranscriptBuffer = [];
        if (plugin) {
            try {
                if (cancel) await plugin.cancelListening();
                else await plugin.stopListening();
            } catch (error) { console.warn("Could not stop Android ASR:", error); }
        }
        voice_is_recording = false;
        voice_is_processing = false;
        voice_is_speaking = false;
        androidNativeListening = false;
        isVoiceInputConfigured = false;
        androidInitPromise = null;
    }

    function scheduleAndroidDetectResume() {
        if (!androidDetectShouldResume || androidResumeTimer) return;
        androidResumeTimer = setTimeout(async () => {
            androidResumeTimer = null;
            const sendButton = document.getElementById("btnsend");
            if (getAsrConfig().provider !== "android" || Number(localsettings.voice_typing_mode || 0) !== 1 ||
                !androidDetectShouldResume || !isVoiceInputConfigured || !sendButton || sendButton.disabled ||
                voice_is_processing || tts_is_playing || is_popup_open()) return;
            androidDetectShouldResume = false;
            try { await startAndroidListening(true); }
            catch (error) {
                androidDetectShouldResume = false;
                setAsrStatus(error.message || String(error), true);
            }
        }, 550);
    }

    // Detect Voice pauses while an LLM response is in progress and resumes after
    // Lite enables the send button again. This mirrors ready_to_record()'s gate.
    update_submit_button = function (...args) {
        const result = originalUpdateSubmitButton.apply(this, args);
        if (getAsrConfig().provider === "android" && Number(localsettings.voice_typing_mode || 0) === 1) scheduleAndroidDetectResume();
        return result;
    };

    init_voice_typing = function (...args) {
        if (getAsrConfig().provider !== "android") return originalInitVoiceTyping.apply(this, args);
        ensureAndroidAsrInitialized().then(() => {
            const mode = Number(localsettings.voice_typing_mode || 0);
            if (mode === 1) return startAndroidListening(true);
            if (mode === 2 && voice_is_speaking) return startAndroidListening(true);
            if (mode === 3 && voice_is_speaking) return startAndroidListening(true);
            return null;
        }).catch(error => {
            setAsrStatus(error.message || String(error), true);
            localsettings.voice_typing_mode = 0;
            const mode = document.getElementById("voice_typing_mode");
            if (mode) mode.value = "0";
            update_asr_ui(false);
        });
    };

    ptt_start = function (...args) {
        if (getAsrConfig().provider !== "android") return originalPttStart.apply(this, args);
        if (localsettings.voice_typing_mode == 3 && voice_is_speaking) {
            androidManualStopRequested = true;
            ptt_end(true);
            return;
        }
        if (Number(localsettings.voice_typing_mode || 0) <= 0) return;
        if (Number(localsettings.voice_typing_mode) === 2 || Number(localsettings.voice_typing_mode) === 3) {
            androidManualStopRequested = false;
            androidToggleTranscriptBuffer = [];
        }
        voice_is_speaking = true;
        ++voice_speaking_counter;
        if (!isVoiceInputConfigured) {
            init_voice_typing();
            return;
        }
        if (!ready_to_record()) return;
        voice_is_recording = true;
        update_submit_button(false);
        startAndroidListening(Number(localsettings.voice_typing_mode) === 2 || Number(localsettings.voice_typing_mode) === 3).catch(error => {
            voice_is_recording = false;
            voice_is_speaking = false;
            setAsrStatus(error.message || String(error), true);
            update_submit_button(false);
        });
    };

    ptt_end = function (force = false) {
        if (getAsrConfig().provider !== "android") return originalPttEnd.apply(this, arguments);
        if (localsettings.voice_typing_mode == 3 && !force) return;
        if (Number(localsettings.voice_typing_mode || 0) <= 0) return;
        if (Number(localsettings.voice_typing_mode) === 2 || (Number(localsettings.voice_typing_mode) === 3 && force)) {
            androidManualStopRequested = true;
        }
        voice_is_speaking = false;
        const delay = Math.max(0, Number(localsettings.voice_end_delay || 0));
        setTimeout(async () => {
            if (voice_is_speaking) return;
            voice_is_processing = true;
            update_submit_button(false);
            const plugin = getAndroidSpeechPlugin();
            if (!plugin) return;
            try { await plugin.stopListening(); }
            catch (error) {
                voice_is_processing = false;
                setAsrStatus(error.message || String(error), true);
            }
        }, delay);
    };

    // Keep upstream settings UI and save flow; the separate ASR profile is loaded
    // before init() and remains available when persist_session is disabled.
    display_settings = function (...args) {
        const result = originalDisplaySettings.apply(this, args);
        syncAsrControlsFromSettings();
        return result;
    };

    confirm_settings = function (...args) {
        const previousProvider = getAsrConfig().provider;
        const provider = document.getElementById("asr_provider");
        if (provider) update_asr_ui();
        const result = originalConfirmSettings.apply(this, args);
        const currentProvider = getAsrConfig().provider;
        update_asr_ui(false); // refresh voice button after Lite commits settings
        persistAsrSettings();
        if (previousProvider === "android" && currentProvider !== "android") {
            stopAndroidSpeech(true).then(() => {
                if (Number(localsettings.voice_typing_mode || 0) > 0) {
                    isVoiceInputConfigured = false;
                    originalInitVoiceTyping();
                }
            });
        } else if (currentProvider === "android" && Number(localsettings.voice_typing_mode || 0) > 0) {
            init_voice_typing();
        }
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

        if (cfg.provider === "android") {
            throw new Error("Android On-device ASR listens to the live microphone through SpeechRecognizer; it does not transcribe uploaded audio files. Select GigaSTT or KoboldCpp Whisper for file transcription.");
        }
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
        if (getAsrConfig().provider === "android") {
            if (typeof msgbox === "function") msgbox("Android On-device ASR processes live microphone input only. Select GigaSTT or KoboldCpp Whisper to transcribe an audio file.", "Android ASR");
            return;
        }
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
    if (getAsrConfig().provider === "android") refreshAndroidAsrStatus(true);
    registerAndroidSpeechListeners();
    console.log("KoboldAI Lite ASR adapter v5 installed (KoboldCpp + GigaSTT + Android on-device).");
})();

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
