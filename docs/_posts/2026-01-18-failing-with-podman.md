---
layout: post
title: Failing to replace Docker with Podman for Dev Containers
date: 2026-01-18 10:00 +0100
category: docker
author: Tomas Ekeli
tags: [docker, podman, wsl, development, devcontainers]
excerpt: I tried replacing Docker Desktop with Podman on Windows. It didn't work out. Here's what happened, what I learned, and why I'm back on Docker Desktop.
main-image: /assets/img/2026-01-18-failing-with-podman.webp
main-image-alt: Purple seals on a "bliss" background. One of them has a captain's hat and a cup with two handles and a Kubernetes logo. The other has a small cog.
---

![{{ page.main-image-alt }}]({{ page.main-image }})

I spent my Sunday trying to replace Docker Desktop with Podman. It didn't work out. Here's what happened, what I learned, and why I'm back on Docker Desktop.

## The motivation

Docker Desktop's licensing changed a while back, and while it's not expensive, I was curious about alternatives. Podman keeps coming up as the obvious choice: it's open source, daemonless, rootless by default, and claims Docker CLI compatibility. My C: drive was also running extremely low on space, and I figured a fresh start might help with that out too.

## What worked

Installation was straightforward:

```powershell
winget install RedHat.Podman
podman machine init
podman machine start
```

Basic container operations work fine. The CLI is compatible enough that you can alias `docker` to `podman` and most commands just work:

```powershell
Set-Alias -Name docker -Value podman
docker run hello-world  # works
docker ps               # works
```

I moved the Podman machine to my E: drive to save space on C:, which was easy enough with WSL's export/import:

```powershell
wsl --export podman-machine-default E:\podman\backup.tar
wsl --unregister podman-machine-default
wsl --import podman-machine-default E:\podman\machine E:\podman\backup.tar
```

Podman Desktop exists too, if you want a nice GUI similar to Docker Desktop.

## Hitting a wall

I use devcontainers **a lot**. They're how I keep my development environments reproducible and contained. I wrote about them [back in 2023](/2023/03/devcontainers/), and they've become central to how I work.

When I tried to open a project in VS Code and launch the devcontainer, things quickly fell apart.

The first problem: VS Code's Dev Containers extension runs inside my Ubuntu WSL distro, where it looks for a Docker socket at `/var/run/docker.sock`. But Podman runs in its own separate WSL distro (`podman-machine-default`), exposing its API through a Windows named pipe. These two can't talk to each other directly.

## Tying things together

I spent hours setting up a relay between the Windows named pipe and a Unix socket in Ubuntu WSL. This involved:

- Installing `npiperelay` on Windows to bridge named pipes to stdin/stdout
- Installing `socat` in Ubuntu WSL to listen on a Unix socket
- Writing a script to wire them together

```bash
sudo socat UNIX-LISTEN:/var/run/docker.sock,fork,mode=666 \
    EXEC:"npiperelay.exe -ep //./pipe/podman-machine-default",nofork
```

After some debugging (`npiperelay` wasn't in PATH when running under sudo, the `socat` process was messing with terminal settings, etc.), the relay actually worked. `docker ps` from Ubuntu WSL talked to Podman successfully.

But the devcontainer builds still failed.

## Unsurmountable filesystem issues

The devcontainer build got further, but then failed with an error about an invalid symlink in a devcontainer feature. I worked around that by removing the offending feature. Then it failed because the workspace folder was empty.

The bind mount: the thing that maps my actual project folder (in the Ubuntu WSL distro filesystem) into the container: wasn't working. The container was running, the mount was configured, but the folder was empty inside the container.

This is a fundamental problem: **Podman's WSL distro cannot see the filesystem of my Ubuntu WSL distro.**

Docker Desktop solves this transparently. It has special filesystem sharing between its VM and all WSL distros. Podman doesn't have that. This is good for security, but bad for my workflow. Its WSL distro is isolated.

My options at this point were:

1. Move all my code to a Windows drive (C: or E:): that's *slow*, especially for git operations from within a Linux container
2. Clone repos inside the Podman machine directly: then I lose all my tooling, git credentials, SSH keys, and dotfiles
3. Install Podman natively inside Ubuntu WSL instead of using the Windows Podman: this is its own can of worms and might not work seamlessly with VS Code either
4. Go back to Docker Desktop

## The trade-offs

Podman's security-first approach is genuinely good. Rootless by default, no daemon, better isolation. But this security isolates the running container from the filesystem I need, and that broke my workflow.

There's also value in using the standard approach. When you use mainstream tooling:
- Sources like Stack Overflow are easier to find
- Blog tutorials apply
- Colleagues can help
- VS Code extensions are tested against it

This is a general point: Every deviation from standard adds friction. I can absorb a Sunday of troubleshooting. But if I recommended this to my teams of developers, that's many work-days lost, plus ongoing support burden, plus "it works on my machine" debugging when setups drift. One of the major points of using containers is to reduce such friction, not add to it.

The real cost of Docker Desktop licensing: $5/user/month or whatever it is now: suddenly looks cheap compared to developer time.

## Back to Docker Desktop

I cleaned up Podman:

```powershell
podman machine stop
podman machine rm
winget uninstall RedHat.Podman
wsl --unregister podman-machine-default
```

And reinstalled Docker Desktop:

```powershell
winget install Docker.DockerDesktop
```

One thing I made sure to do: move Docker's data to E: immediately. In Docker Desktop's settings, under Resources → Advanced → Disk image location, you can point it at another drive. No more filling up C:.

The devcontainer built and started on the first try. My files were there. Everything just worked.

## Conclusion

Podman is a good tool. It works well for many things. Its security model is genuinely better than Docker's. But for using Dev Containers on Windows with WSL, it fails.

For my workflow: devcontainers with code living in WSL's native filesystem: Docker Desktop is still the pragmatic choice. The "magic" it does behind the scenes to make filesystem sharing work across WSL distros is exactly what I need.

Maybe Podman will solve this eventually. Maybe there's a configuration I missed. But after a full Sunday of trying, I'm back where I started, with a bit more appreciation for what Docker Desktop actually does.

Sometimes the boring, mainstream choice is the right one.

And, I know - why do I still use Windows for my host OS?
