# Claude themes

## Versions

Every change that is pushed bumps the version of each theme it touches, so an installed copy picks it up with `claude plugin update`. A theme's version is in two places, and they always match:

- `themes/<name>/.claude-plugin/plugin.json`: `"version"`
- `.claude-plugin/marketplace.json`: the theme's entry, `"version"`

Bump the minor number (0.2.0 → 0.3.0) for a new feature or a visible change to the look, the patch number (0.2.0 → 0.2.1) for a fix. One bump per push is enough, however many commits it carries.

## Checks

Before pushing a change to a theme, from its folder: `claude plugin validate .` and `claude plugin test .`.
