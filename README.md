# Claude themes

Animated themes for the Claude desktop app. Each theme is its own plugin in `themes/<name>/`, so you can install just the one you want.

| Theme | What it does |
| --- | --- |
| [Matrix Rain](themes/matrix-rain/) (`matrix-rain`) | Green code that drifts while idle, pours while Claude works, drops coloured streams on every tool call, has letters that change as they fall, and chimes when a reply ends. |

## Install a theme

At the prompt of a Claude Code terminal session:

```
/plugin install matrix-rain --marketplace fredy-mederos/matrix_claude_theme
```

Answer `y` to add the marketplace, then pick a scope (user scope puts it in every session).

From a shell:

```bash
claude plugin install matrix-rain --marketplace fredy-mederos/matrix_claude_theme
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `fredy-mederos/matrix_claude_theme`, then **Add plugin**.

Swap `matrix-rain` for any theme's name in the table above.

## One theme at a time

A session has one look. With two themes on, they compete: the last one to start wins the look, while the other's sounds and reactions keep running. Keep one on, and turn the others off with their own command (Matrix Rain: `/matrix off`).

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
2. Add an entry to `.claude-plugin/marketplace.json`: `{ "name": "<name>", "source": "./themes/<name>", "description": "…" }`.
3. Add a row to the table above, and a `README.md` in its folder.
4. `scripts/link-themes <name>`, then check it: `claude plugin validate themes/<name>` and `claude plugin test themes/<name>`.
