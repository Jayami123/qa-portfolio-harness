# Standalone Mattermost MCP server (ADR 0006, decision Q2). DEVELOPMENT-ONLY upstream: used here for local testing only.
# Built from a pinned commit of mattermost/mattermost-plugin-agents. Base images are pinned by digest.
#
# The build context is the adapter's build folder (.harness/mattermost/build). It holds this file and extra-ca.pem.
# extra-ca.pem is appended to the system trust store. It is empty unless the host sits behind a TLS-intercepting proxy
# (set MATTERMOST_EXTRA_CA_FILE). CI leaves it empty.
ARG GO_IMAGE=golang:1.27.3-alpine3.24@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18
ARG RUNTIME_IMAGE=alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
ARG MM_AGENTS_COMMIT=96ecd17ce4d4b6cbcec1abcd2a9173759b4e85e1

FROM ${GO_IMAGE} AS build
ARG MM_AGENTS_COMMIT
COPY extra-ca.pem /tmp/extra-ca.pem
RUN cat /tmp/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt && rm /tmp/extra-ca.pem
RUN apk add --no-cache git ca-certificates
WORKDIR /src
RUN git clone https://github.com/mattermost/mattermost-plugin-agents.git . \
 && git checkout --detach "${MM_AGENTS_COMMIT}" \
 && test "$(git rev-parse HEAD)" = "${MM_AGENTS_COMMIT}"
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mattermost-mcp-server ./mcpserver/cmd

FROM ${RUNTIME_IMAGE}
COPY extra-ca.pem /tmp/extra-ca.pem
RUN cat /tmp/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt && rm /tmp/extra-ca.pem
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 mcp
COPY --from=build /out/mattermost-mcp-server /usr/local/bin/mattermost-mcp-server
USER mcp
EXPOSE 8066
ENTRYPOINT ["/usr/local/bin/mattermost-mcp-server"]
