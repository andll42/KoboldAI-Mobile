import { registerPlugin } from '@capacitor/core';

// This module is bundled by esbuild and loaded before KoboldAI Lite's pwa-setup.
// No browser implementation is supplied: desktop/web must not silently use a
// non-local speech recognizer.
const AndroidSpeech = registerPlugin('AndroidSpeech');
window.KoboldAndroidSpeech = AndroidSpeech;
