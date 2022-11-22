These instructions are to build and run mjolnir without using [Docker](./setup_docker.md).
You need to have installed `yarn` 1.x and Node 16.

```bash
git clone https://github.com/matrix-org/mjolnir.git
cd mjolnir

yarn install
yarn build

# Copy and edit the config. It *is* recommended to change the data path,
# as this is set to `/data` by default for dockerized mjolnir.
cp config/default.yaml config/production.yaml
nano config/production.yaml

node lib/index.js --mjolnir-config ./config/production.yaml
```
