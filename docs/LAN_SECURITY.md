# LAN security quick reference

Expected Android WebView Origin: `https://localhost`.

GigaSTT:

```bat
gigastt serve --host 0.0.0.0 --port 9876 --bind-all --allow-origin https://localhost
```

Do not use `--cors-allow-any`. Add Windows Firewall inbound rule TCP 9876 only for Private profile. Never port-forward 9876 to the Internet.

KoboldCpp: bind/listen on the PC LAN interface; permit TCP 5001 only on Private profile; use KoboldCpp authentication if available. Never port-forward 5001 to the Internet.

The Android application is configured to allow cleartext HTTP for user-selected LAN addresses. This is not encryption or a per-host firewall. Use it only on a trusted Wi-Fi network. For remote use, replace HTTP with TLS and an authenticated reverse proxy.
