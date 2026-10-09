# Embedded Communication Toolkit 0.1.8

English | [简体中文](README.zh-CN.md)

Developer: 常州竟锋软件有限公司

VS Code local communication workbench, MVP development candidate.
Not yet certified for public Marketplace release.

## Features

- Serial: enumeration/manual path, baud, 7/8 bits, parity, stop bits, DTR/RTS and RTS/CTS.
- TCP Client and TCP Server (16 clients, explicit target or confirmed broadcast).
- IPv4 UDP: source and datagram boundaries, explicit broadcast, configurable payload limit.
- Up to 8 sessions, HEX/7-bit ASCII, timestamps, RX/TX counters, virtualized preview.
- Bounded serial send queue, timeout cleanup and delivery-unknown reporting.
- Optional reconnect for TCP Client and uniquely identifiable serial devices.
- Completion-delayed automatic sending; disconnection stops automation.
- Quick commands with optional dangerous-operation confirmation.
- Explicit project `.vscode/ect.json` configuration, versioned validation and overwrite checks.
- No-workspace configuration uses extension globalState; multi-root prompts for a root.
- JSONL original recording independent of preview; bounded global queue, rotation, budget and incomplete marker.
- Streaming TXT/CSV export from stopped recording, formula injection protection.

## Workbench Layout

Version 0.1.8 moves TCP Server target selection into the send pane. A sole
connected client is selected by default; multiple clients require an explicit
target, and broadcast still requires confirmation. Manual, quick and automatic
send cannot start without a valid target. A disconnected explicit target is
not silently replaced by another client.

Version 0.1.6 places the Session label above a single row containing the session
selector, Open/Close/Delete, reconnect and status controls. Selects, action
buttons and status badges share a 30px height; narrow panels scroll that row
horizontally instead of wrapping controls.

Version 0.1.5 unifies input, select-option and serial-popup colors using the
current VS Code theme. Native control color schemes follow VS Code light,
dark and high-contrast theme classes; serial hover colors and the receive
background no longer use mismatched button/code-block surfaces.

Version 0.1.4 adds 21 common baud-rate presets from 300 to 2000000, with
115200 selected by default. Choose Custom baud rate for other integer rates
between 1 and 3000000; actual support depends on the device and driver.

Version 0.1.3 replaces the native serial-port datalist popup with an inline
dropdown anchored below its input, avoiding Webview popup-position offsets.
Manual paths, arrow-key selection, Enter, Escape and outside-click dismissal
are supported. Refresh ports populates the list.

Version 0.1.2 takes layout inspiration from uplume's Serial Tool - Serial Port
Monitor: connection controls at the top, receive log on the left, send payload
and quick commands on the right, and counters/display options at the bottom.
Narrow panels stack receive and send sections vertically. ECT retains its
multi-session Serial/TCP/UDP model; this is not a copy of all Serial Tool features.

Receive HEX/ASCII display and send HEX/ASCII encoding are independent.
Search filters the displayed text (the first 256 bytes of each record); Show TX
and timestamps only affect the preview, never the original recording.
Grouped presets, draggable splitters, CRC and throughput-rate widgets are not
implemented in this candidate.

## Usage

Install the Windows x64 VSIX, then run `ECT: Open Communication Workbench`.
Alternatively, click the Communication activity icon, then the Open Communication
Workbench button in the empty Connections view or its persistent title-bar action.
The sidebar lists sessions; the main communication UI opens in an editor panel.
Create a session, select it and explicitly click Open. No saved configuration
automatically opens devices or sends data. Closing the panel keeps sessions,
automation and recording alive; Close/Disconnect All/extension deactivation stops them.

Record and export select local files through VS Code dialogs. Destinations must
be new files: existing logs are never silently overwritten. Export stops recording
first and refuses a source marked incomplete.

## Languages

Simplified Chinese and English are supported. The workbench language selector
or `ect.language` accepts `auto` (default, follows VS Code), `zh-CN` and `en`.
Workbench labels, connection states, dynamic confirmations and configuration
dialogs change without reconnecting sessions. The selection is persisted in
VS Code settings (an existing workspace override takes precedence).
Command titles and native view titles use `package.nls` and follow the VS Code
display language, independently of the workbench override.
User session/command names, payloads, logs and raw driver/network diagnostics
are not translated. Internal diagnostic probes still include English technical output.

Communication runs on the local UI Extension Host, including remote workspaces.
It does not connect to remote-host devices. Workspace filesystem accessibility
depends on the remote URI provider.

## Safety

Trusted workspaces only. Host validates all commands, lengths and parameter ranges.
Serial opening may reset boards despite signal settings. Automatic serial reconnect
requires a unique serial number/VID/PID match; ambiguous or missing identities
are not reconnected. TCP/UDP are plaintext. External listeners and broadcasts
require confirmation. Automatic sending never resumes by itself after reconnect.
TX accepted means local write completion, not remote receipt or command success.
TCP/Serial chunks are not protocol frames; UDP delivery is not guaranteed.

Preview retains bounded history; per-row display truncates at 256 bytes.
Original logs retain full payload. Zero-length UDP datagrams are recorded/counted
as events but are not currently pushed through the byte-based preview ACK window.
Partial TCP broadcasts report per-client results; aggregate TX byte counter does
not currently count the successful subset of a partially failed broadcast.

## Development

Use Node.js 22.11+, `npm ci`, then:

```powershell
npm run typecheck
npm test
npm run build
npm run package:vsix
npm run inspect:vsix
npm run probe:packaged
```

Open this directory and F5 launches the development extension.
Native dependencies are external to the Host bundle; users do not run npm/node-gyp.
Test logs/download caches use OS temporary directories. The UI preview bridge
in `scripts/preview.mjs` is test-only and excluded from VSIX.

Real official Extension Host test:

```powershell
$env:ECT_TEST_EXECUTABLE = "C:\Path\To\Code.exe"
npm run test:extension
```

Without that variable the runner downloads VS Code 1.95.0; `-- stable` selects
stable. `npm_config_https_proxy` is supported. User/extensions directories are isolated.

## Remaining Release Gates

Official minimum/stable VS Code, physical serial hardware/drivers and unplug,
clean-machine offline installation, remote/multi-root URIs, real Host Webview ACK,
accessibility and sustained throughput/memory/disk-fault tests remain uncertified.
Node/browser-bridge tests do not substitute for these checks.
CRC/Parser/Plot and other platforms/protocols are future versions, not this MVP.

## Privacy and License

No telemetry or upload. Device payloads may contain secrets; protect local logs.
Original project code is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 常州竟锋软件有限公司.
Third-party code and dependencies retain their respective copyrights and
licenses; this project's MIT license does not replace those terms.
Third-party source/license review and Marketplace publisher setup remain
required before public release. The package remains marked `private` to prevent
accidental npm publication; this does not restrict the MIT license.
