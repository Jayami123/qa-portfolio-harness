# Base image for Cursor Cloud Agents on this repo (referenced by .cursor/environment.json).
# Docker block follows https://cursor.com/docs/cloud-agent/setup ("Running Docker").
# Do not COPY the project: Cursor clones the repo and runs `install` itself.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git gnupg openssl sudo xz-utils \
    && rm -rf /var/lib/apt/lists/*
# Node.js 22 (the harness .nvmrc) on PATH, and pnpm 10.11.1 (the Medusa fork's pin).
ARG NODE_VERSION=22.23.3
# Node.js 24 for Documenso only (fork engines node >= 24, npm >= 11.17). Not on PATH; use "$NODE24".
ARG NODE24_VERSION=24.21.0
ENV COREPACK_HOME=/opt/corepack
ENV NODE24=/opt/node24/bin/node
RUN arch="$(dpkg --print-architecture)" && \
    case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) echo "unsupported $arch"; exit 1 ;; esac && \
    curl --retry 3 -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 && \
    mkdir -p /opt/node24 && \
    curl --retry 3 -fsSL "https://nodejs.org/dist/v${NODE24_VERSION}/node-v${NODE24_VERSION}-linux-${node_arch}.tar.xz" \
    | tar -xJ -C /opt/node24 --strip-components=1 && \
    mkdir -p "$COREPACK_HOME" && corepack enable && corepack prepare pnpm@10.11.1 --activate && \
    chmod -R a+rwX "$COREPACK_HOME" && node --version && pnpm --version && /opt/node24/bin/node --version
# Docker (Cursor's recommended setup for Docker inside Cloud Agents).
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y \
    docker-ce=5:28.5.2-1~ubuntu.24.04~noble \
    docker-ce-cli=5:28.5.2-1~ubuntu.24.04~noble \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y fuse-overlayfs && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /etc/docker && printf '%s\n' '{' '  "storage-driver": "fuse-overlayfs"' '}' > /etc/docker/daemon.json
RUN apt-get update && apt-get install -y iptables && rm -rf /var/lib/apt/lists/*
RUN update-alternatives --set iptables /usr/sbin/iptables-legacy && \
    update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
# Non-root user with docker group and passwordless sudo (as in Cursor's example).
RUN id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu
RUN groupadd -f docker && usermod -aG docker ubuntu && usermod -aG sudo ubuntu && \
    echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu && chmod 0440 /etc/sudoers.d/ubuntu
USER ubuntu
WORKDIR /home/ubuntu
