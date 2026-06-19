---
layout: post
title: Cool down your dependencies
date: 2026-06-19 08:00:00 +0200
category: security
author: Tomas Ekeli
tags: [security, supply-chain, dependencies, dependabot, devops]
excerpt: Supply-chain attacks move fast and get caught fast. A dependency cooldown, ignoring any version published less than a few days ago, blocks most of them for a one-line config change. Here is how to turn it on across npm, PyPI, NuGet, Maven, and your editor.
---

There have been a lot of supply-chain attacks going around recently. Someone nefarious gets control of the publish rights of a piece of software we use to build other software, a library or a dev tool, and push out a version with a malicious payload. The payload usually moves fast: it spreads itself and / or extracts secrets like keys and crypto wallets as soon as it is installed. Some attacks even identify any publishing rights they can get and push malicious versions to other packages.

The speed of these attacks is frightening, but also a clear signal that makes people react. The attacks are usually spotted and pulled within hours. This means that the attacks have a narrow window. A study of ten prominent attacks found eight of the ten had a window of opportunity under a week. *By not immediately installing the newest version on the day it is published you protect yourself from most attacks.*

A valid mitigation is a "cooldown", "minimum release age" or "delay": tell your tooling to ignore any version that was published less than N days ago.

**Recommendation:** delay automatic updates by a conservative default of about a week. If a week is too conservative, even 2-3 days catches most of these attacks. This is for *automatic* updates only. You are an excellent filter. The attack vector is not tricking *you*, it is to piggy-back on automated updates.

In Dependabot and Renovate a cooldown only applies to routine version updates, not to security updates. Common Vulnerabilities and Exposures (CVE) patches still come through promptly. By using a cooldown you are not slowing down your security fixes.

### How to turn it on

The single highest-leverage move you can make is probably in your dependabot / renovate configuration. This covers the ecosystems that have no native option (Composer, NuGet, Maven). Regrettably this cannot be set at Enterprise level, and must be configured per repository. Set a cooldown once in `.github/dependabot.yml` and it applies across managers:

```yaml
# .github/dependabot.yml
cooldown:
  default-days: 7
```

Renovate equivalent, in `renovate.json`:

```json
"packageRules": [
  {
    "matchUpdateTypes": [
      "major",
      "minor",
      "patch"
    ],
    "minimumReleaseAge": "7 days"
  }
]
```

If you also want protection on local `install` commands (not just bot PRs), here are the native settings per ecosystem:

| Ecosystem | Tool (min version) | Setting | Example |
|---|---|---|---|
| JavaScript | npm (11.10+) | `min-release-age` in `.npmrc` | `min-release-age=7` (days) |
| JavaScript | pnpm (10.16+) | `minimumReleaseAge` | `minimumReleaseAge: 10080` (minutes) |
| JavaScript | Yarn (4.10+) | `npmMinimalAgeGate` in `.yarnrc.yml` | `npmMinimalAgeGate: "7d"` |
| JavaScript | Bun (1.3+) | `minimumReleaseAge` in `bunfig.toml` | `259200` (seconds = 3d) |
| Python | pip (26.1+) | `--uploaded-prior-to` | `pip install --uploaded-prior-to=P7D` |
| Python | uv (0.9.17+) | `exclude-newer` in `pyproject.toml` | `exclude-newer = "7 days"` |
| Python | poetry (2.4+) | `solver.min-release-age` | `poetry config solver.min-release-age 7` |
| Ruby | Bundler (4.0.13+) | `cooldown` | `bundle config set cooldown 7` |
| PHP | Composer | none yet | use Dependabot / Renovate |
| .NET | `dotnet-outdated` tool (restore itself: none yet) | `-ot` / `--older-than` (days) | `dotnet outdated -u --older-than 7` |
| Java | Maven / Gradle | none yet | use Dependabot / Renovate |
| Editor | VS Code (1.123+) | `extensions.autoUpdateDelay` in settings (hours, default 2) | `"extensions.autoUpdateDelay": 168` (7 days) |

Yes, the feature has a different name in almost every tool (`cooldown`, `minimumReleaseAge`, `min-release-age`, `npmMinimalAgeGate`, `exclude-newer`...) and even different time units (minutes, seconds, hours, days). I think this is a sign that our industry is scrambling to patch this into our workflows. Here are some excellent write-ups about it, worth a read if you want the background:

- Andrew Nesbitt, *[Package Managers Need to Cool Down](https://nesbitt.io/2026/03/04/package-managers-need-to-cool-down.html)*
- William Woodruff, *[We should all be using dependency cooldowns](https://blog.yossarian.net/2025/11/21/We-should-all-be-using-dependency-cooldowns)*

This table will quickly become outdated, every tool seems to add or rename its setting every few weeks. [cooldowns.dev](https://cooldowns.dev) keeps a current list of the exact setting for each package manager and tool, including ones I left out here (Deno, pixi, Hex, Cargo, Scala Steward). It's a good source to keep in mind. If you are wiring this into a repo, check there for the up-to-date syntax rather than trusting my snapshot.
