# Claude Code mods

This repository is a plugin marketplace for [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview). It contains one mod: `token-weather-limits`.

## token-weather-limits

This mod draws a band of neon pills above the prompt. The pills show the context window, the session cost, and your usage limits.

![The band of pills in the Claude desktop app](docs/preview.svg)

### What each pill shows

| Pill | Content |
| :- | :- |
| Weather | A forecast for the context window (Clear, Cloudy, Showers, Storm, Compact soon), a chart of the last 12 turns, and the tokens that the last turn added. |
| CTX | The percent of the context window that is used, and the tokens used of the window. |
| Tokens | The tokens in the context window and the session cost in US dollars. |
| 5h | The percent of the 5-hour limit that is used, and the time until it resets. |
| 7d | The percent of the 7-day limit that is used, and the time until it resets. |

### Colours

- A limit pill (5h or 7d) turns red when 80% or more is used.
- The CTX pill turns red when 90% or more is used.

### Layout

- The pills form two groups: context (weather, CTX, tokens) and limits (5h, 7d).
- If all five pills fit on one line, the context group is at the left and the limit group is at the right.
- If the band is too narrow, each group starts a new line. The pills fill each line from the left. A very narrow band shows one pill on each line.

### Where it works

| Place | Result |
| :- | :- |
| Code tab of the Claude desktop app (local and SSH sessions) | Neon pills, drawn as SVG |
| `claude` in a terminal | The same pills, drawn as coloured text |
| Cloud sessions and WSL sessions | The mod does not load |

## Requirements

- Claude Code v2.1.287 or later in a terminal. The desktop app needs its bundled Claude Code v2.1.286 or later.
- A Claude subscription for the 5h and 7d pills. The limit figures come from the API responses, so they appear after the first reply.

## Install

Run this command in a Claude Code session:

```text
/plugin install token-weather-limits --marketplace wenhao-shi/claude-mods
```

Or run these commands in your shell:

```bash
claude plugin marketplace add wenhao-shi/claude-mods
```

```bash
claude plugin install token-weather-limits@wenhao-shi-mods --scope user
```

If a session is already open, run `/reload-plugins` in that session.

In the desktop app, you can also use **+ > Plugins > Manage plugins** to turn the mod on or off.

## Security

A mod runs with your permissions and is not in a sandbox. Read the code before you install a mod.

This mod reads only the usage figures from `$.session.usage()`. It does not read or write files, start processes, or make network requests. To see the events and calls of the mod, run this command on a clone of the repository:

```bash
claude plugin validate ./token-weather-limits
```

## Test

```bash
claude plugin test ./token-weather-limits
```

The test checks the pill order, the percent values, the red colour, and the layout from one line to five lines. It runs on the terminal and desktop surfaces.

## Known limits

- The colours are made for the dark theme.
- The band width comes from the app in character cells. The mod converts cells to pixels with an estimate of 8.6 px for each cell. This value was measured in the desktop app at 100% display scale. At a different scale, the band can change to two lines earlier than necessary.
- The text uses the Segoe UI font, with system fonts as a fallback.

## Credits and license

This mod is based on [Token Weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather) by Anthropic, licensed under Apache-2.0. This repository uses the same license. See [LICENSE](LICENSE).

Changes from Token Weather:

- The band is a row of round neon pills. The desktop app draws them as SVG. The terminal draws them as text.
- New pills for the 5-hour limit, the 7-day limit, and the session cost.
- A layout with two groups that changes from one line to as many as five lines.
- The band reads its size from `e.props`. The original read `e.hasSurvey` and `e.bodyColumns`, which are not set.
