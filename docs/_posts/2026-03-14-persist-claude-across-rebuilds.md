---
layout: post
title: Persisting Claude Code auth across devcontainer rebuilds
date: 2026-03-14 11:22:48 +0100
category: [vscode]
author: Tomas Ekeli
tags: [devcontainers, claude, vscode]
excerpt: How to persist Claude Code authentication across devcontainer rebuilds so you don't have to re-authenticate every time you build your devcontainer.
---

![{{ page.main-image-alt }}]({{ page.main-image }})

## Persisting Claude Code auth across devcontainer rebuilds

If you use Claude Code (the CLI tool or the VS Code extension) inside a devcontainer, you lose your authentication and history every time you rebuild. This is annoying if you're like me and rebuild quite often.

The extension and the CLI store their state in slightly different places. The VS Code extension seems to keep its data in `~/.claude/`, while the CLI makes a file `~/.claude.json` and stores its auth data there. Both of these are in the home directory, which gets wiped on rebuilds.

Why Anthropic chose to put the data in different places is a mystery to me. They probably vibe-coded it.

## The volume

Devcontainers let you mount named volumes that survive rebuilds. I already had one [for shell history](https://code.visualstudio.com/docs/devcontainers/tips-and-tricks#_persisting-user-profile), so I added another volume for `~/.claude/`.

If you're using `docker-compose.yml` for your devcontainer, add the volume there:

```yaml
# docker-compose.yml
services:
  devcontainer:
    volumes:
      - claude-data:/home/vscode/.claude

volumes:
  claude-data:
```

Replace `vscode` with whatever your container user is - docker-compose doesn't support variable expansion here, so it has to be a literal path.

If you're using a plain `devcontainer.json` without Compose (i.e. referencing an image or a dockerfile), you can use the `mounts` property instead, and it does support variables:

```json
"mounts": [
  "source=claude-data,target=${containerEnv:HOME}/.claude,type=volume"
]
```

This lets the extension remember its state across rebuilds immediately - its auth and session data live in that directory and the volume keeps them around.

## The CLI's auth file

The CLI's `~/.claude.json` is a little bit trickier. It's a single file in the home directory, and the home directory gets recreated on rebuild. We can't easily mount a volume to a single file, **but** we can put the real file inside the volume and symlink to it.

First, copy the existing auth file into the volume (after you've authenticated at least once):

```bash
cp ~/.claude.json ~/.claude/.claude.json
```

Then replace it with a symlink:

```bash
ln -sf ~/.claude/.claude.json ~/.claude.json
```

The `-sf` flags mean: create a **s**ymbolic link, and **f**orce-overwrite if something's already there.

Now when the CLI reads or writes `~/.claude.json`, it follows the symlink into the volume. Re-auths write through the symlink too, so fresh tokens end up persisted.

## Surviving rebuilds

To recreate the symlink automatically after each rebuild, add a `postCreateCommand` to your `devcontainer.json`. My style is to put a post-create script in `.devcontainer/post-create.sh` and call it from there, as these scripts can get too long for a single JSON property:

```json
"postCreateCommand": ".devcontainer/post-create.sh"
```

With the script containing:

```bash
#! /bin/bash
set -e

echo "Running post-create script..."
echo ""

echo "Creating symbolic link for .claude.json from volume file..."
ln -sf /home/vscode/.claude/.claude.json /home/vscode/.claude.json

echo ""
echo "Post-create script completed."
```

I use `postCreateCommand` rather than `postStartCommand` because it only needs to run once after the container is created. There is a chance that the claude CLI might delete the file and recreate it, which would break the symlink, but in practice I haven't seen that happen. If it does, we can always switch to `postStartCommand` to ensure the symlink is recreated on every start. Then you'd also have to deal with copying the new file first, since the old one in the volume would be stale. This is left as an exercise for the reader.

## Now rebuilds are a non issue

Two things to persist, two different approaches - a volume mount for the directory, and a symlink for the lone file. Rebuild away.
