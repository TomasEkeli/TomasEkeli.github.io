---
layout: post
title: Running the devcontainer CLI without installing it
date: 2026-02-08 16:55:48 +0100
categories: [docker, devcontainers, devops, vscode]
author: Tomas Ekeli
tags: [devops, docker, development, devcontainers, vscode]
excerpt: How to run the devcontainer CLI without installing it on your host machine, using only Docker.
---

I like devcontainers. I really like that they remove the "it works on my machine" problem, and I also really *really* like that they keep my machine clean. They do this by freeing me from installing all kinds of developer tools on my machine. I just run devcontainers, and whatever strange toolset is needed for the particular project or stack I'm working on just works. Gone are the days of having strange versions of node, python, java, rust, etc. installed on my machine. I just run devcontainers, and everything works.

Ironic then, that the devcontainer CLI tool needs Node, NPM, Python and C/C++ (in particular versions). Yes, [I'm not kidding](https://github.com/devcontainers/cli#npm-install). This is a travesty, and should not be allowed to stand! It is, in fact, registered as [an issue](https://github.com/devcontainers/cli/issues/63), which has been open since summer 2022. That is creeping up on 4 years ago, at the time of writing. Safe to say - it's not going to be fixed.

Personally, I don't really care all that much - I use devcontainers through VS Code and that handles all interactions with them for me. But, it is wrong, dammit. Just plain wrong!

There should be only one dependency for devcontainers, and that is Docker! Well, Docker and Linux, but that's a given. And a computer. And the internet. Oh, gods, we're depending on the internet again. Well, let's get this exercise in futility on the road:

## The Devcontainer CLI

Well, how do we get the devcontainer CLI without installing it? Like any programmer I'm a fan of recursion, so immediately I thought - we run it in a devcontainer! Silly, right? Without a devcontainer CLI we cannot run a devcontainer. True, but we can step down one level and run it in a docker container. In fact, one of the common devcontainers already contain most of what we need to run the devcontainer CLI: `mcr.microsoft.com/vscode/devcontainers/typescript-node`.

Let's just try it out - and see if we can run the devcontainer CLI from there:

```bash
host $ docker run --rm -it \
    --entrypoint /bin/bash \
    mcr.microsoft.com/vscode/devcontainers/typescript-node
root ➜ / $ npm install -g @devcontainers/cli
# installation logging...
root ➜ / $ devcontainer --version
0.83.0
```

Good, that worked! We can indeed install the devcontainer CLI in the container and run it. Now, let's make a docker image out of this, so we don't have to install the devcontainer CLI every time, so we make this Dockerfile:

```dockerfile
FROM mcr.microsoft.com/vscode/devcontainers/typescript-node
RUN npm install -g @devcontainers/cli
ENTRYPOINT ["devcontainer"]
```

And build it:

```bash
host $ docker build -t devcontainer-cli .
```

Great - now we have a docker image with the devcontainer CLI installed. Let's run it:

```bash
host $ docker run --rm -it devcontainer-cli --version
0.83.0
```

That's cool, but we want to run it as if it was a tool on our host machine (without installing), so we need to give the running container access to our host's Docker daemon and file-system. To make it easier to call, we also put it inside a bash-script instead of typing it out every time (we *are* lazy, after all). Here's the script (called `dc.sh`):

```bash
#!/bin/bash
docker run --rm -it \  # run, but remove when done
    -v /var/run/docker.sock:/var/run/docker.sock \ # give access host docker
    -v "$(pwd)":"$(pwd)" \ # access current directory (and subdirectories)
    -w "$(pwd)" \ # set working directory
    devcontainer-cli "$@" # pass all arguments to container
```

This script mounts the docker socket, so the container can talk to the host's Docker daemon. It also mounts the current directory (and subdirectories) into the container, and sets the working directory to the current directory. Finally, it passes all arguments to the `devcontainer` command inside the container. With it we should be able to run the devcontainer CLI as if it was installed on our host machine, without actually installing it.

```bash
host $ chmod +x dc.sh
host $ ./dc.sh --version
0.83.0
```

Excellent!

## One small snag

Very cool so far, let's try it out:

```bash
host $ mkdir test-devcontainer
host $ cd test-devcontainer
host $ ../dc.sh up
# unhappy logs about not being able to find a devcontainer.json file
```

Of course! We need to tell the devcontainer CLI what do start!

```bash
host $ mkdir .devcontainer
host $ echo '{
    "name": "Test Devcontainer",
    "image": "mcr.microsoft.com/devcontainers/base:ubuntu"
}' > .devcontainer/devcontainer.json
host $ ../dc.sh up
[4 ms] @devcontainers/cli 0.83.0. Node.js v24.13.0. linux 6.6.87.2-microsoft-standard-WSL2 x64.
Error: spawn docker ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:286:19)
    at onErrorNT (node:internal/child_process:484:16)
    at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
{"outcome":"error","message":"spawn docker ENOENT","description":"An error occurred setting up the container."}
```

And this is where we hit a snag. Turns out the container we based off of doesn't have Docker installed, so it can't talk to the Docker daemon. Easily fixed - we just modify our Dockerfile to install Docker:

```dockerfile
FROM mcr.microsoft.com/vscode/devcontainers/typescript-node

# Install docker and clean up after
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*

# Install devcontainer CLI
RUN npm install -g @devcontainers/cli

ENTRYPOINT ["devcontainer"]
```
Now we build the image again, and try to run it:

```bash
host $ docker build -t devcontainer-cli .
host $ ../dc.sh up
[2 ms] @devcontainers/cli 0.83.0. Node.js v24.13.0. linux 6.6.87.2-microsoft-standard-WSL2 x64.
[+] Building 0.8s (6/6) FINISHED
# chatty logs omitted..
Container started
{"outcome":"success","containerId":"c55f3e53963bcc08f8e6484e79334d219b47757d9ed3daf05841e487e516fc3f","remoteUser":"vscode","remoteWorkspaceFolder":"/workspaces/setup"}
host $ docker ps
# list of containers running - one of which should have the containerId from above
```

And there we have it! The devcontainer CLI is running, and it can talk to the Docker daemon on our host machine, and it can see our files. We can run all devcontainer CLI commands as if it was installed on our host machine, without actually installing it.

## Conclusion

This was a fun little exercise showing how we can use containers to run tools without installing them on our host machine. The devcontainer CLI is just one example, but this approach can be used for any tool that can run in a container. We just need to make sure the container has access to the necessary resources (like the Docker daemon and the file system) to do its job.

Personally I haven't really used the devcontainer CLI outside of VS Code, but it's good to know that we can run it without installing it, and that we can even run it in a container if we want to.

For developers who want to use devcontainers without VS Code, maybe directly from the command line this could be helpful. Or for CI/CD pipelines that want to use devcontainers without installing the CLI on the build agents. There must be dozens of you out there!

For me it just scratches the itch of the devcontainer CLI (a tool that I use to avoid installing things on my host machine) requiring me to install things on my host machine.

Until next time!

## Addendum: Docker socket permissions on Linux

If you're trying this on a pure Linux host (as opposed to Docker Desktop on macOS or Windows), you might get a permission-problem when the container tries to talk to the Docker socket. This is because the socket is owned by the `docker` group on your host, and the user inside the container isn't a member of that group.

The fix is to tell Docker to add the host's docker group to the container process. Update `dc.sh` to:


```bash
#!/bin/bash
docker run --rm -it \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$(pwd)":"$(pwd)" \
    -w "$(pwd)" \
    --group-add $(stat -c '%g' /var/run/docker.sock) \
    devcontainer-cli "$@"
```

The `stat -c '%g'` command gets the group-ID of the socket file, and `--group-add` grants that group to the container's process. Now the container should have access to write to the socket without running as root or changing permissions on the host.