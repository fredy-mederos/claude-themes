# Claude themes

Animated themes for the Claude desktop app. Each theme is its own plugin in `themes/<name>/`, so you can install just the one you want.

<a href="themes/matrix-rain/"><img src="themes/matrix-rain/screenshots/live.svg" alt="Matrix Rain: green code and coloured tool-call streams falling down a black screen" width="100%"></a>

| Theme | What it does |
| --- | --- |
| [Matrix Rain](themes/matrix-rain/) (`matrix-rain`) | Green code that drifts while idle, pours while Claude works, storms when it writes a lot, drops coloured streams on every tool call, has letters that change as they fall, and chimes when a reply ends. On black, or on pale paper with `/matrix light`. |
| [Clockworks](themes/clockworks/) (`clockworks`) | An iron gear train that stands still and muted while idle, turns while Claude works, spins faster when it writes a lot, and rings a small bell when a reply ends. |

<a href="themes/clockworks/"><img src="themes/clockworks/screenshots/live.svg" alt="Clockworks: an iron gear train turning on a dark graphite ground" width="100%"></a>

## Install a theme

At the prompt of a Claude Code terminal session:

```
/plugin install matrix-rain --marketplace fredy-mederos/claude-themes
```

Answer `y` to add the marketplace, then pick a scope (user scope puts it in every session).

From a shell:

```bash
claude plugin install matrix-rain --marketplace fredy-mederos/claude-themes
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `fredy-mederos/claude-themes`, then **Add plugin**.

Swap `matrix-rain` for any theme's name in the table above.

## Update a theme

Claude Code keeps its own copy of the marketplace and doesn't refresh it by itself, so `claude plugin update` alone reports the version you already have. Refresh the marketplace first, then update the theme:

```bash
claude plugin marketplace update claude-themes
claude plugin update matrix-rain@claude-themes
```

Then restart the app to load the new version. Swap `matrix-rain` for the theme's name.

## One theme at a time

A session has one look. With two themes on, they compete: the last one to start wins the look, while the other's sounds and reactions keep running. Keep one on, and turn the others off with their own command (Matrix Rain: `/matrix off`; Clockworks: `/clockworks off`).

## Working on the themes locally

This folder is the repository. Claude Code loads a theme from `~/.claude/skills/<name>/`, so each theme is linked there from `themes/<name>/`, and an edit here shows in the next new session.

```bash
scripts/link-themes                  # link every theme in themes/
scripts/link-themes matrix-rain      # link one
scripts/link-themes --unlink matrix-rain
```

Linking only the theme you're using is the simplest way to keep one on.

### Adding a theme

1. Make its folder: `~/.claude/skills/claude-themes/scripts/new-theme <name> themes` (or copy `themes/matrix-rain` and rename it everywhere).
2. Add an entry to `.claude-plugin/marketplace.json`: `{ "name": "<name>", "source": "./themes/<name>", "version": "0.1.0", "description": "…" }`, the same version as its `plugin.json`.
3. Add a row to the table above, and a `README.md` in its folder.
4. `scripts/link-themes <name>`, then check it: `claude plugin validate themes/<name>` and `claude plugin test themes/<name>`.
