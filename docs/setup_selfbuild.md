To build mjolnir, you have to have installed `yarn` 1.x and Node 16.

```bash
git clone https://github.com/matrix-org/mjolnir.git
cd mjolnir

yarn install
yarn build

# Edit the config.
# You probably should change `dataPath`.
nano config/default.yaml

node lib/index.js
```

Or, if you wish to use a different configuration file, e.g. `development.yaml`

```bash
git clone https://github.com/matrix-org/mjolnir.git
cd mjolnir

yarn install
yarn build

# Edit the config.
# You probably should change `dataPath`.
cp config/default.yaml config/development.yaml
nano config/development.yaml

NODE_ENV=development node lib/index.js
```
