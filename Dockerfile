# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# build the app
ENV NODE_ENV=production
RUN bun run build

# final image with only production assets
FROM base AS release
COPY --from=install /temp/dev/node_modules node_modules
COPY --from=prerelease /usr/src/app/dist dist
COPY --from=prerelease /usr/src/app/server server
COPY --from=prerelease /usr/src/app/package.json .

# create data directory for SQLite persistence
RUN mkdir -p data && chown bun:bun data

# run the app
USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "serve" ]
