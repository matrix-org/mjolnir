To build mjolnir, you have to have installed and [Node >16](https://nodejs.org/en/download/), [npm](https://docs.npmjs.com/cli/v7/configuring-npm/install) and [yarn >1.x](https://classic.yarnpkg.com/en/docs/install).

Get the latest release-version https://github.com/matrix-org/mjolnir/releases/latest/ - for example `v1.5.0`.

```bash
git clone https://github.com/matrix-org/mjolnir.git --branch v1.5.0
cd mjolnir

yarn install
yarn build

# Copy and edit the config. It *is* recommended to change the data path.
cp config/default.yaml config/development.yaml
nano config/development.yaml

# Start Mjolnir
node lib/index.js
```
