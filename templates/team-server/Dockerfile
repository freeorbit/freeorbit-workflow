# The team ask server: `wf team serve`, from the kit a project pins
# (docs/design/team-server.md). Build it from the kit's own folder:
#
#   docker build -f node_modules/freeorbit-workflow/templates/team-server/Dockerfile node_modules/freeorbit-workflow
#
# The host gives it WF_TEAM_ORIGIN and WF_TEAM_ADMIN_TOKEN, and mounts a
# volume that outlasts a restart at /data. It listens on 8080; the host's
# ingress gives it HTTPS. Probes: GET /__team/health.
# The base image is pinned by its digest, so the same kit builds the same server; update it on purpose.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /kit
COPY bin ./bin
COPY lib ./lib
COPY plugins ./plugins
COPY package.json ./
ENV NODE_ENV=production WF_TEAM_DATA=/data PORT=8080
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "bin/wf.mjs", "team", "serve"]
