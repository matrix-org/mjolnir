To build mjolnir, you have to have installed and [Node >16](https://nodejs.org/en/download/), [npm](https://docs.npmjs.com/cli/v7/configuring-npm/install) and [yarn >1.x](https://classic.yarnpkg.com/en/docs/install).

```bash
git clone https://github.com/matrix-org/mjolnir.git
cd mjolnir

yarn install
yarn build

# Copy and edit the config. It *is* recommended to change the data path.
cp config/default.yaml config/development.yaml
nano config/development.yaml

node lib/index.js
```
