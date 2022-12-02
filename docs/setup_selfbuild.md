These instructions are to build and run mjolnir without using [Docker](./setup_docker.md).
To build mjolnir, you have to have installed [Node >=16](https://nodejs.org/en/download/), [npm](https://docs.npmjs.com/cli/v7/configuring-npm/install) and [yarn >1.x](https://classic.yarnpkg.com/en/docs/install).

Copy the latest release tag from https://github.com/matrix-org/mjolnir/releases/latest/ to use when cloning. For example `v1.6.1` - please check the link for the current version as this mentioned example might be outdated.

```bash
git clone https://github.com/matrix-org/mjolnir.git --branch <release tag>
cd mjolnir

yarn install
yarn build

# Copy and edit the config. It *is* recommended to change `dataPath`,
# as this is set to `/data` by default for dockerized mjolnir.
cp config/default.yaml config/production.yaml
nano config/production.yaml

# Start Mjolnir and use production.yaml (instead of default.yaml)
node lib/index.js --mjolnir-config ./config/production.yaml
```
