---
layout: post
title: Where is my disk space? Docker ate it.
date: 2026-03-06 13:25
category: docker
author: Tomas Ekeli
tags: [docker, devcontainers, disk-space, windows, wsl]
excerpt: How to find and reclaim hundreds of gigabytes that Docker Desktop silently consumes on Windows, and the vhdx file you probably don't know about.
---

# Where is my disk space? Docker ate it.

I use a lot of devcontainers. They're great - reproducible environments, no polluting my host machine, easy to share with colleagues. But they come with a cost that sneaks up on you: disk space.

I recently found myself with only 59GB free on a 1TB drive. That's not great. I had a suspicion about where it all went, I've been here before.

## Finding the culprit

As I said - I've been through this before. Last time I found that Docker's build cache had ballooned to 284GB. Just the build cache. I cleaned that up and compacted the virtual hard disks and got a decent chunk back. But here I was again, running low.

A quick check:

```bash
docker system df
```

```
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          34        34        93.43GB   14.44GB (15%)
Containers      40        0         53.28GB   53.28GB (100%)
Local Volumes   48        48        140.4GB   0B (0%)
Build Cache     699       0         0B        0B
```

93GB in images, 53GB in container layers, 140GB in volumes. That's kind of a lot. But the build cache was already at 0B this time - I had pruned that previously.

## The containers

40 containers, none running. Most are stopped devcontainers from various projects I work on. Each one accumulates writable data over time - installed packages, build artifacts, caches. Some had several gigabytes of writable data.

I listed them with their last-used dates and image names to figure out which ones I still needed:

```bash
```bash
docker ps -a \
    --format '{{.Names}}' \
    | while read name; do
    finished=$(
        docker inspect "$name" \
            --format \
                '{{.State.FinishedAt}}' \
            | cut -dT -f1
    )
    started=$(
        docker inspect "$name" \
            --format \
                '{{.State.StartedAt}}' \
            | cut -dT -f1
    )
    if [[ "$finished" \
                > "$started" ]]; then
        last="$finished"
    else
        last="$started"
    fi
    created=$(
        docker inspect "$name" \
            --format '{{.Created}}' \
            | cut -dT -f1
    )
    image=$(
        docker inspect "$name" \
            --format \
                '{{.Config.Image}}'
    )
    echo "${last}|${created}|\
${name}|${image}"
done | sort
```
```

Devcontainer images are named `vsc-[projectname]-[hash]`, so it's easy to tell what's what. I had containers from 8 months ago that I'd completely forgotten about.

I went through and removed the ones I didn't need anymore. Important: don't just blindly delete everything. If you use devcontainers, your stopped containers hold state you might want. I kept anything I'd used in the last couple of weeks and anything for active projects.

## Shared volumes

Something I learned during this cleanup: many devcontainers share volumes. Things like `shell-history`, `minikube-config`, and the `vscode` volume itself are often shared across multiple containers. This is actually probably bugs in how we've set up our devcontainers with named volumes to have things survive rebuilds (hint: make the project-name part of the volume-name).

This does mean that if you have three iterations of a python project as separate containers, they might all share the same shell history and config volumes. Deleting the older containers won't lose that data - the volumes persist as long as at least one container still references them.

You can check what volumes each container uses:

```bash
docker ps -a --format '{{.Names}}' | while read c; do
  echo "=== $c ==="
  docker inspect "$c" --format '{{range .Mounts}}{{.Type}} {{.Name}} {{.Destination}}{{println}}{{end}}'
done
```

## Pruning carefully

After removing old containers, I pruned in stages:

```bash
# images not referenced by containers
docker image prune -a -f

# volumes not referenced by containers
docker volume prune -f

# Remove build cache
# do this LAST, it tends to re-appear
docker builder prune -a -f
```

One thing that surprised me: build cache keeps re-appearing. After pruning images, suddenly there's build cache again. Is this the build-cache from the image that's being kept aroudn? I don't know.  I ended up running the builder prune multiple times. Run `docker system df` between rounds to see if more has surfaced.

After all the pruning I'd freed about 144GB inside Docker. Images went from 93GB to 53GB, containers from 53GB to 24GB, volumes from 140GB to 119GB, and build cache gave up about 52GB across several rounds.

## The vhdx file you don't know about

Here's the thing that tripped me up last time, and that I only discovered properly this time: Docker on Windows uses multiple virtual hard disk files, and you need to compact all of them.

I knew about these two:
- `C:\Users\...\AppData\Local\Docker\wsl\main\ext4.vhdx` - the Docker engine
- `C:\Users\...\AppData\Local\Packages\CanonicalGroupLimited.Ubuntu_...\LocalState\ext4.vhdx` - Ubuntu WSL

But there was a third one:
- `C:\Users\...\AppData\Local\Docker\wsl\disk\docker_data.vhdx` - **the actual Docker data**

That third file was 555GB. Yes, really. The `main/ext4.vhdx` that I'd been diligently compacting was tiny in comparison. All the container layers, images, volumes - it all lived in `docker_data.vhdx`.

The names and locations of the virtual hard-drives may vary by setup. Find all of them with:
```bash
find /c/Users/<YourUsername>/AppData -name "*.vhdx" 2>/dev/null
```

## Compacting the vhdx files

The virtual hard disks grow as Docker writes data, but they do not automagically shrink. Even after you delete data inside Docker, the vhdx file stays the same size on your Windows drive. You have to compact them manually.

Here's the process, and the order *matters*:

### 1. Kill Docker Desktop first

`docker desktop stop` tended to hang forever on my machine. If it works for you - great! If it doesn't, instead:

1. Open Task Manager, find Docker Desktop, end the process tree
2. Then run `wsl --shutdown`

The order matters. Docker Desktop keeps a file handle on the vhdx files even after WSL shuts down. If you don't kill Docker Desktop first, `diskpart` won't be able to open the files. Then again, that *may* only have been for my never-ending docker desktop process. Not sure.

### 2. Compact in diskpart

Open `diskpart.exe` (it needs admin rights, and will open a new terminal): For each of the virtual hard-drive -files you've found do:

```
select vdisk file="path_to_the_vhdx"
compact vdisk
```

The `docker_data.vhdx` took the longest - mine was at 555GB and took a while (time for lunch). If it gets stuck partway, leave it for a while, if it doesn't recover - `Ctrl+C` to cancel that (you can also restart the compaction if you want).

### 3. Start back up

```bash
wsl
docker desktop start
```

Verify everything is still there with `docker system df`.

## Was it worth it?

In my case I recovered about 380GB of space on my C-drive. Pretty good, and definitely necessary when I was down to just over 10GB before I started.

Without compaction all the space freed inside Docker will be reused by Docker instead of it allocating new blocks and growing the vhdx further, so this will buy you time before you need to do it again or buy a bigger drive. With compaction you get the space back on your drive, but it will be used up again as you use Docker.

If you have the time to clean up and compact it, it's worth it.

## The checklist

For my future self, and for anyone else running lots of devcontainers on Windows:

1. Run `docker system df` to see where the space is
2. List containers by last used date, remove ones you don't need
3. Check for shared volumes before deleting containers
4. `docker image prune -a -f`
5. `docker volume prune -f`
6. `docker builder prune -a -f` (run this last, and maybe twice)
7. Kill Docker Desktop process tree, then `wsl --shutdown`
8. Find **all** vhdx files - especially `docker_data.vhdx`
9. Compact all of them in `diskpart.exe`
10. Start WSL and Docker Desktop back up
11. Verify with `docker system df`

Docker's disk usage is hidden behind virtual hard disks that only grow and never shrink. And the biggest one might not be the one you'd expect, go looking through your disk for others!
