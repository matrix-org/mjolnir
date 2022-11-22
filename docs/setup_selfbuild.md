To build mjolnir, you have to have installed [Node >16](https://nodejs.org/en/download/), [npm](https://docs.npmjs.com/cli/v7/configuring-npm/install) and [yarn >1.x](https://classic.yarnpkg.com/en/docs/install).

Get the latest release-version https://github.com/matrix-org/mjolnir/releases/latest/ - for example `v1.6.0`.

```bash
git clone https://github.com/matrix-org/mjolnir.git --branch v1.6.0
cd mjolnir

yarn install
yarn build

# Copy and edit the config. It *is* recommended to change the data path.
cp config/default.yaml config/production.yaml
nano config/production.yaml

# Start Mjolnir and make use of the production.yaml (instead of default.yaml)
NODE_ENV=production node lib/index.js
```
